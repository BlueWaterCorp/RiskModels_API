#!/usr/bin/env python3
"""Bulk Stock Deep Dive (DD) renderer — pure-zarr, offline, batch-friendly.

Renders {ticker}_DD_latest.{png,pdf} for a list of tickers using the zarr path
verified byte-equivalent to the API path (see sdk/scripts/p1_zarr_vs_api_diff.py
for the proof). Designed for the 3K bulk run after the MAG7 validation.

Default output layout matches the GCS website pattern so files can be uploaded
unchanged later:

    {out_dir}/
      AAPL/AAPL_DD_latest.png
      AAPL/AAPL_DD_latest.pdf
      MSFT/MSFT_DD_latest.png
      MSFT/MSFT_DD_latest.pdf
      ...
      _bulk_run_log.jsonl     (one row per ticker — status + timing + error)
      _bulk_summary.json      (overall counts + duration)

The default output dir is **/Volumes/ext_2t/Stock_Snapshots** (external 2 TB
drive, 1.8 TB free). Override with --out-dir or BULK_SNAPSHOT_DIR env var.

Ticker selection (mutually exclusive, falls through in this order):
  --tickers AAPL MSFT NVDA      # explicit list
  --tickers-file path.txt       # one per line
  --universe uni_mc_3000        # auto-discover from ds_masks.zarr (DEFAULT)

Examples
--------
    # Bulk MAG7 to external drive (will skip the GCS upload step):
    export ERM3_ZARR_ROOT=/path/to/zarr/root
    PYTHONPATH=sdk python sdk/scripts/bulk_dd_render.py \
        --tickers AAPL MSFT NVDA AMZN GOOG META TSLA

    # Full uni_mc_3000 universe (~2.9K tickers, ~1-2h on a laptop):
    export ERM3_ZARR_ROOT=/path/to/zarr/root
    PYTHONPATH=sdk python sdk/scripts/bulk_dd_render.py

    # Resume after a crash — skips tickers whose PNG+PDF already exist:
    export ERM3_ZARR_ROOT=/path/to/zarr/root
    PYTHONPATH=sdk python sdk/scripts/bulk_dd_render.py --resume

    # Same run + upload to GCS as we go:
    export ERM3_ZARR_ROOT=/path/to/zarr/root
    PYTHONPATH=sdk python sdk/scripts/bulk_dd_render.py --upload-gcs

    # At least 1k names to gs://rm_api_public/snapshot (with SEC profile blurbs):
    export ERM3_ZARR_ROOT=/path/to/zarr/root
    export ERM3_ROOT=/path/to/ERM3
    PYTHONPATH=sdk:$ERM3_ROOT python sdk/scripts/bulk_dd_render.py \\
        --sec-profile-json-root /path/to/company_profiles/v1 \\
        --limit 1000 --upload-gcs --resume

    # Regenerate every ticker after a layout change (same flags as above plus):
    #   --resume --force

Why this script vs mag7_dd_zarr_vs_api.py
-----------------------------------------
mag7_dd_zarr_vs_api.py is a **validation** script — its job is to compare the
zarr render to a GCS or local reference and report PNG diffs. This script is a
**throughput** runner — it just renders, logs, optionally uploads, and moves
on. Different concerns, different defaults.

Peer comparison
---------------
By default we render WITHOUT API peers (no PeerGroupProxy.from_ticker calls).
At 3K tickers, even one-API-call-per-ticker is meaningful latency. Pass
--api-peers to opt back in (DD's scatter + DNA panels will then use real peer
data; otherwise they fall back to target-only rendering, the same way
mag7_dd_zarr_vs_api.py --no-api-peers behaves).
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

# -----------------------------------------------------------------------------
# Paths
# -----------------------------------------------------------------------------
_REPO_ROOT = Path(__file__).resolve().parents[2]
_SDK_ROOT = Path(__file__).resolve().parents[1]


def _default_zarr_root() -> Path:
    from riskmodels.snapshots.zarr_context import default_erm3_zarr_path

    return default_erm3_zarr_path()


def _default_out_dir() -> Path:
    """External 2TB drive — overridable with BULK_SNAPSHOT_DIR.

    Hard-coded to /Volumes/ext_2t/Stock_Snapshots because that's where the
    operator wants 3K worth of artifacts to land (verified mounted with 1.8TB
    free; the local sdk/riskmodels/snapshots/output/ tree is for ad-hoc work).
    """
    if os.environ.get("BULK_SNAPSHOT_DIR"):
        return Path(os.environ["BULK_SNAPSHOT_DIR"])
    return Path("/Volumes/ext_2t/Stock_Snapshots")


# -----------------------------------------------------------------------------
# Ticker discovery
# -----------------------------------------------------------------------------

def _load_universe_tickers(zarr_root: Path, universe: str) -> list[str]:
    """Pull the in-mask tickers from ds_masks.zarr at the latest teo.

    Mirrors how post_sync_trim_and_evict.py reads ``uni_mc_3000`` — same source
    of truth, so the bulk run targets exactly the symbols Supabase considers
    in-universe today. Each ``uni_mc_<N>`` mask is already the hysteretic top-N by
    market cap (see ``config.yaml::universe_mask.n_values``), so ``uni_mc_1000``
    **is** the canonical top-1000 list — no further cap-sort needed to pick
    membership.

    Ordering returned is alphabetical (stable and reproducible); if you're
    passing ``--limit`` against a larger universe (e.g. ``uni_mc_3000 --limit
    1000``), call :func:`_cap_rank_tickers` afterwards to pick the biggest N by
    market cap instead of the alphabetical first N.
    """
    import xarray as xr

    masks_path = zarr_root / "ds_masks.zarr"
    if not masks_path.is_dir():
        raise FileNotFoundError(f"ds_masks.zarr not found at {masks_path}")
    ds = xr.open_zarr(masks_path, consolidated=True)
    if universe not in ds.data_vars:
        raise ValueError(
            f"universe '{universe}' not found in ds_masks.zarr "
            f"(available: {sorted(ds.data_vars)})"
        )
    last_teo = ds.teo.values[-1]
    mask = ds[universe].sel(teo=last_teo).values.astype(bool)
    tickers_arr = ds.ticker.values[mask]
    out: list[str] = []
    for t in tickers_arr:
        if isinstance(t, bytes):
            t = t.decode("utf-8")
        s = str(t).strip()
        if s and s != "nan":
            out.append(s.upper())
    return sorted(set(out))


def _cap_rank_tickers(zarr_root: Path, tickers: list[str]) -> list[str]:
    """Sort ``tickers`` descending by latest ``market_cap`` from ds_daily.zarr.

    Missing / NaN caps fall to the end. Falls back to the input order on any
    failure so a missing ``ds_daily.zarr`` never blocks a run that already has
    an explicit ticker list.
    """
    if not tickers:
        return []
    try:
        import numpy as np
        import xarray as xr

        daily_path = zarr_root / "ds_daily.zarr"
        if not daily_path.is_dir():
            return list(tickers)
        ds = xr.open_zarr(daily_path, consolidated=True)
        last_teo = ds.teo.values[-1]
        d = ds.sel(teo=last_teo)
        tkr = np.asarray(d["ticker"].values)
        cap = np.asarray(d["market_cap"].values).astype(float)
        decoded = np.array(
            [
                (t.decode("utf-8") if isinstance(t, bytes) else str(t)).upper().strip()
                for t in tkr
            ]
        )
        lookup: dict[str, float] = {}
        for name, c in zip(decoded, cap):
            if not name or name == "NAN":
                continue
            prev = lookup.get(name)
            if prev is None or (np.isfinite(c) and (not np.isfinite(prev) or c > prev)):
                lookup[name] = float(c)
        def _key(t: str) -> tuple[int, float, str]:
            c = lookup.get(t.upper())
            if c is None or not np.isfinite(c):
                return (1, 0.0, t)
            return (0, -c, t)
        return sorted(tickers, key=_key)
    except Exception:
        return list(tickers)


# -----------------------------------------------------------------------------
# Per-ticker render
# -----------------------------------------------------------------------------

def _render_one(
    ticker: str,
    out_root: Path,
    zarr_root: Path,
    *,
    api_client,
    upload_gcs: bool,
    gcs_bucket: str,
    resume: bool,
    force: bool = False,
    sec_profile_json_root: Path | None = None,
) -> dict:
    """Render one ticker's DD to PNG + PDF. Returns a status dict for the log.

    ``upload_gcs`` controls *per-ticker* upload only. Set it to False and use
    ``--upload-mode batch`` in :func:`main` when running at scale — ``gcloud
    storage rsync`` of the whole output tree is several × faster than N×2
    invocations of ``gcloud storage cp``.
    """
    from riskmodels.peer_group import PeerGroupProxy
    from riskmodels.snapshots.stock_deep_dive import (
        DDData,
        render_dd_to_pdf,
        render_dd_to_png,
    )
    from riskmodels.snapshots.zarr_context import build_p1_from_zarr

    t0 = time.perf_counter()
    tdir = out_root / ticker
    png = tdir / f"{ticker}_DD_latest.png"
    pdf = tdir / f"{ticker}_DD_latest.pdf"

    if resume and not force and png.is_file() and pdf.is_file():
        return {
            "ticker": ticker,
            "status": "skipped_resume",
            "duration_s": 0.0,
            "png": str(png),
            "pdf": str(pdf),
        }

    try:
        p1 = build_p1_from_zarr(ticker, zarr_root)

        profile_blurb: str | None = None
        if sec_profile_json_root is not None:
            try:
                from riskmodels.snapshots.zarr_context import symbol_for_ticker_zarr
                from riskmodels.snapshots.sec_profile_blurb import load_sec_profile_blurb

                sym = symbol_for_ticker_zarr(ticker, zarr_root)
                root_v = sec_profile_json_root.expanduser().resolve()
                profile_blurb = load_sec_profile_blurb(sym, root_v)
            except Exception:
                profile_blurb = None

        peer_comparison = None
        if api_client is not None:
            try:
                proxy = PeerGroupProxy.from_ticker(
                    api_client, ticker,
                    group_by="subsector_etf",
                    weighting="market_cap",
                    sector_etf_override=p1.subsector_etf,
                    max_peers=15,
                )
                peer_comparison = proxy.compare(api_client)
            except Exception:
                # Per-ticker peer failure is non-fatal — render with target-only.
                pass

        dd = DDData(
            p1=p1,
            peer_comparison=peer_comparison,
            company_profile_text=profile_blurb,
        )

        tdir.mkdir(parents=True, exist_ok=True)
        render_dd_to_png(dd, png)
        render_dd_to_pdf(dd, pdf)

        uploaded = False
        if upload_gcs:
            for local, name in ((png, png.name), (pdf, pdf.name)):
                dest = f"{gcs_bucket}/{ticker}/{name}"
                try:
                    subprocess.run(
                        ["gcloud", "storage", "cp", str(local), dest],
                        check=True, capture_output=True, text=True,
                    )
                except subprocess.CalledProcessError as e:
                    return {
                        "ticker": ticker,
                        "status": "uploaded_partial",
                        "duration_s": round(time.perf_counter() - t0, 2),
                        "png": str(png),
                        "pdf": str(pdf),
                        "upload_error": e.stderr,
                    }
            uploaded = True

        return {
            "ticker": ticker,
            "status": "ok",
            "duration_s": round(time.perf_counter() - t0, 2),
            "png": str(png),
            "pdf": str(pdf),
            "uploaded": uploaded,
            "has_peers": peer_comparison is not None,
        }
    except Exception as exc:
        return {
            "ticker": ticker,
            "status": "error",
            "duration_s": round(time.perf_counter() - t0, 2),
            "error": str(exc),
            "traceback": traceback.format_exc().splitlines()[-3:],
        }


def _rsync_out_dir_to_gcs(out_dir: Path, gcs_bucket: str) -> tuple[bool, str]:
    """One-shot batch upload: push the full ``out_dir`` tree to ``gcs_bucket``.

    Uses ``gcloud storage rsync --recursive`` (parallelised by gcloud itself).
    Excludes the run log / summary so they stay local. Returns ``(ok, stderr)``
    so callers can fold it into the summary.
    """
    cmd = [
        "gcloud",
        "storage",
        "rsync",
        "--recursive",
        "--exclude",
        r"^_bulk_.*\.(jsonl|json)$",
        str(out_dir),
        gcs_bucket,
    ]
    try:
        proc = subprocess.run(cmd, check=True, capture_output=True, text=True)
        return True, proc.stdout + proc.stderr
    except subprocess.CalledProcessError as e:
        return False, (e.stdout or "") + "\n" + (e.stderr or "")
    except FileNotFoundError as e:
        return False, f"gcloud not found: {e}"


# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__.split("\n\n", 1)[0],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument(
        "--zarr-root",
        type=Path,
        default=None,
        help="Directory containing ds_daily.zarr (default: ERM3_ZARR_ROOT). "
             "Not required for --dry-run when using --tickers or --tickers-file.",
    )
    ap.add_argument("--out-dir", type=Path, default=_default_out_dir(),
                    help="Output root. Default: /Volumes/ext_2t/Stock_Snapshots "
                         "(override with BULK_SNAPSHOT_DIR env var)")
    ap.add_argument("--universe", default="uni_mc_3000",
                    help="ds_masks.zarr universe key for auto-discovery (default: uni_mc_3000)")
    ap.add_argument("--tickers", nargs="*", default=None,
                    help="Explicit ticker list. Mutually exclusive with --tickers-file.")
    ap.add_argument("--tickers-file", type=Path, default=None,
                    help="Newline-delimited tickers file.")
    ap.add_argument("--api-peers", action="store_true",
                    help="Call the API for PeerGroupProxy (slower, but populates "
                         "DD scatter + DNA panels with real peer data).")
    ap.add_argument("--upload-gcs", action="store_true",
                    help="Upload each ticker's {png,pdf} to GCS as it finishes.")
    ap.add_argument("--gcs-bucket", default="gs://rm_api_public/snapshot")
    ap.add_argument("--resume", action="store_true",
                    help="Skip tickers whose PNG+PDF already exist in --out-dir.")
    ap.add_argument(
        "--force",
        action="store_true",
        help="Re-render even when PNG+PDF already exist (overwrites). "
             "With --resume, disables skip-on-existing so all tickers are regenerated "
             "(typical after a snapshot layout change).",
    )
    ap.add_argument("--limit", type=int, default=None,
                    help="Cap the run to the first N tickers (for smoke tests).")
    ap.add_argument("--dry-run", action="store_true",
                    help="Resolve the ticker list, print the count + first 10, exit.")
    ap.add_argument(
        "--sec-profile-json-root",
        type=Path,
        default=None,
        help=(
            "Company_profiles version root (contains json/). Injects SEC/LLM blurb into DD left panel; "
            "set ERM3_ROOT so erm3.shared.company_profiles matches Supabase company_snapshot text. "
            "Override with env BULK_DD_SEC_PROFILE_ROOT."
        ),
    )
    args = ap.parse_args()

    sys.path.insert(0, str(_SDK_ROOT))

    if args.zarr_root is None:
        try:
            args.zarr_root = _default_zarr_root()
        except ValueError:
            if args.dry_run and (args.tickers is not None or args.tickers_file):
                args.zarr_root = Path(".")
            else:
                print(
                    "FAIL: set ERM3_ZARR_ROOT or pass --zarr-root (required for universe mode "
                    "and for rendering).",
                    file=sys.stderr,
                )
                return 2
    else:
        args.zarr_root = args.zarr_root.expanduser().resolve()

    # ── Resolve ticker list ──
    if args.tickers:
        tickers = [t.upper() for t in args.tickers]
        source = "argv"
    elif args.tickers_file:
        if not args.tickers_file.is_file():
            print(f"FAIL: --tickers-file does not exist: {args.tickers_file}")
            return 2
        tickers = sorted({
            ln.strip().upper()
            for ln in args.tickers_file.read_text().splitlines()
            if ln.strip() and not ln.startswith("#")
        })
        source = f"file:{args.tickers_file}"
    else:
        try:
            tickers = _load_universe_tickers(args.zarr_root, args.universe)
        except Exception as exc:
            print(f"FAIL: could not load universe '{args.universe}' from "
                  f"{args.zarr_root}: {exc}")
            return 2
        source = f"zarr:{args.universe}"

    if args.limit:
        tickers = tickers[: args.limit]

    sec_profile_root = args.sec_profile_json_root
    if sec_profile_root is None and os.environ.get("BULK_DD_SEC_PROFILE_ROOT", "").strip():
        sec_profile_root = Path(os.environ["BULK_DD_SEC_PROFILE_ROOT"]).expanduser()

    if args.dry_run:
        print(f"source: {source}")
        print(f"out_dir: {args.out_dir}")
        print(f"count: {len(tickers)}")
        print(f"first 10: {tickers[:10]}")
        print(f"sec_profile_json_root: {sec_profile_root}")
        return 0

    if not args.out_dir.parent.is_dir() and not args.out_dir.is_dir():
        print(f"FAIL: --out-dir parent does not exist: {args.out_dir.parent} "
              f"(is /Volumes/ext_2t mounted?)")
        return 2
    args.out_dir.mkdir(parents=True, exist_ok=True)

    # ── API client (only if peers enabled) ──
    api_client = None
    if args.api_peers:
        try:
            from riskmodels import RiskModelsClient
            api_client = RiskModelsClient.from_env()
        except Exception as exc:
            print(f"WARN: --api-peers requested but RiskModelsClient.from_env() "
                  f"failed ({exc}); continuing target-only.")

    # ── Run ──
    t_start = time.perf_counter()
    log_path = args.out_dir / "_bulk_run_log.jsonl"
    summary_path = args.out_dir / "_bulk_summary.json"

    counts = {"ok": 0, "skipped_resume": 0, "error": 0, "uploaded_partial": 0}
    print(f"=== bulk_dd_render ===")
    print(f"  source       : {source}")
    print(f"  count        : {len(tickers)}")
    print(f"  out_dir      : {args.out_dir}")
    print(f"  zarr_root    : {args.zarr_root}")
    print(f"  api_peers    : {api_client is not None}")
    print(f"  upload_gcs   : {args.upload_gcs}")
    print(f"  resume       : {args.resume}")
    print(f"  force        : {args.force}")
    print(f"  sec_profile  : {sec_profile_root}")
    print()

    with log_path.open("w") as logf:
        for i, ticker in enumerate(tickers, start=1):
            row = _render_one(
                ticker,
                args.out_dir,
                args.zarr_root,
                api_client=api_client,
                upload_gcs=args.upload_gcs,
                gcs_bucket=args.gcs_bucket,
                resume=args.resume,
                force=args.force,
                sec_profile_json_root=sec_profile_root,
            )
            row["i"] = i
            row["ts"] = datetime.now(timezone.utc).isoformat()
            counts[row["status"]] = counts.get(row["status"], 0) + 1
            logf.write(json.dumps(row) + "\n")
            logf.flush()
            tag = {"ok": "✓", "skipped_resume": "⤳", "error": "✗",
                   "uploaded_partial": "⚠"}.get(row["status"], "?")
            extra = f" ({row['duration_s']}s)" if row.get("duration_s") else ""
            err = f" — {row.get('error','')}" if row["status"] == "error" else ""
            print(f"  [{i:>4}/{len(tickers)}] {tag} {ticker}{extra}{err}")

    duration = round(time.perf_counter() - t_start, 1)
    summary = {
        "started_at_utc": datetime.now(timezone.utc).isoformat(),
        "duration_s": duration,
        "count_total": len(tickers),
        "counts": counts,
        "source": source,
        "out_dir": str(args.out_dir),
        "zarr_root": str(args.zarr_root),
        "api_peers": api_client is not None,
        "upload_gcs": args.upload_gcs,
        "resume": args.resume,
        "force": args.force,
        "sec_profile_json_root": str(sec_profile_root) if sec_profile_root else None,
        "log_file": str(log_path),
    }
    summary_path.write_text(json.dumps(summary, indent=2))

    print()
    print(f"=== Summary ===")
    print(f"  duration : {duration}s")
    for k, v in counts.items():
        print(f"  {k:<18}: {v}")
    print(f"  log      : {log_path}")
    print(f"  summary  : {summary_path}")
    return 0 if counts.get("error", 0) == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
