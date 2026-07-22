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
    # Use BWMACRO monorepo Python 3.12 venv: .../BWMACRO/.venv/bin/python (+ PYTHONPATH=sdk),
    # or run ./sdk/scripts/run_bulk_dd_render.sh (defaults that venv).

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

    # At least 1k names to gs://rm_api_public/snapshot:
    export ERM3_ZARR_ROOT=/path/to/zarr/root
    PYTHONPATH=sdk python sdk/scripts/bulk_dd_render.py \\
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

# Headless backend before any matplotlib.pyplot import (pulls pyplot lazily inside
# riskmodels.snapshots, but Agg is safe to set unconditionally here).
import matplotlib as _matplotlib

_matplotlib.use("Agg")

import argparse
import hashlib
import json
import os
import subprocess
import signal
import sys
import threading
import time
import traceback
import warnings
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

# Suppress matplotlib's per-figure tight_layout-incompat warning. The
# institutional renderer's _compose_dd_page composes axes that aren't
# tight_layout-friendly by design (intentional inset placement). The warning
# is decorative noise at 1k-ticker scale (2× per render → 2000 lines/run).
warnings.filterwarnings(
    "ignore",
    message=r"This figure includes Axes that are not compatible with tight_layout.*",
    category=UserWarning,
)

try:
    from tqdm.auto import tqdm
except ImportError:  # tqdm is in BWMACRO venv; fall back to plain prints if missing
    tqdm = None  # type: ignore[assignment]

# pyplot.figure is not thread-safe; SnapshotPage uses pyplot internally.
_MATPLOTLIB_RENDER_LOCK = threading.Lock()

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
# Input freshness
# -----------------------------------------------------------------------------

def input_mtime(zarr_root: Path) -> float:
    """Newest write time across the zarr stores a render reads.

    ``--resume`` skips a ticker whose PNG+PDF already exist. On its own that means
    a ticker is rendered once and never again: a rebuilt panel produces no new
    output, and the run still reports success. Comparing against this timestamp
    turns the skip into "output is newer than its inputs", so corrected data is
    picked up automatically while unchanged tickers stay cheap to skip.

    Uses ``.zmetadata`` (rewritten on every consolidated zarr write) rather than
    directory mtimes, which do not change when only chunks are rewritten. Returns
    0.0 when nothing is readable, which makes the caller fall back to plain
    existence-based resume rather than re-rendering the world.
    """
    newest = 0.0
    try:
        for meta in Path(zarr_root).glob("*.zarr/.zmetadata"):
            try:
                newest = max(newest, meta.stat().st_mtime)
            except OSError:
                continue
    except OSError:
        return 0.0
    return newest


FINGERPRINT_MANIFEST = "_render_fingerprints.json"


def symbol_fingerprints(
    zarr_root: Path, tickers: list[str], window_teos: int = 750
) -> dict[str, str]:
    """Per-ticker digest of every input the render reads for that symbol.

    ``input_mtime`` answers "did anything change"; this answers "did anything
    change *for this ticker*". A nightly panel rebuild rewrites every store, so
    a timestamp gate re-renders all 1,000 names even when a repair touched 11 —
    ~1h45m of work to reproduce identical images.

    Variables are discovered dynamically rather than listed: any numeric
    symbol-dimensioned variable in any store under ``zarr_root`` is folded in, so
    an input added later cannot silently escape the digest and leave a ticker
    stale. Stores with no ``ticker`` coordinate (macro factors, ETF series) are
    shared across tickers, so their metadata is folded into a global component
    that every digest carries — a change there correctly invalidates everything.

    Returns ``{}`` when nothing is readable, which makes the caller fall back to
    the timestamp gate rather than skip work it cannot justify skipping.
    """
    import numpy as np
    import xarray as xr

    want = list(dict.fromkeys(tickers))
    per_ticker: dict[str, "hashlib._Hash"] = {t: hashlib.blake2b(digest_size=16) for t in want}
    global_part = hashlib.blake2b(digest_size=16)
    touched = False

    for store in sorted(Path(zarr_root).glob("*.zarr")):
        try:
            ds = xr.open_zarr(store, consolidated=True)
        except Exception:
            continue
        if "ticker" not in ds.coords or "symbol" not in ds.dims:
            # Shared input — fold its metadata in globally.
            try:
                global_part.update(store.name.encode())
                global_part.update((store / ".zmetadata").read_bytes())
            except OSError:
                pass
            continue

        store_tickers = np.array([str(t) for t in ds.ticker.values])
        idx = {t: i for i, t in enumerate(store_tickers)}
        sel = [(t, idx[t]) for t in want if t in idx]
        if not sel:
            continue
        cols = np.array([i for _, i in sel])

        variables = sorted(
            v for v in ds.data_vars
            if "symbol" in ds[v].dims and np.issubdtype(ds[v].dtype, np.number)
        )
        if not variables:
            continue
        try:
            # Subset the symbol axis BEFORE reading. Selecting after the read pulls
            # the whole panel (17k symbols x 750 teos x N vars per store) to keep a
            # few hundred columns, which costs more than the render it is meant to
            # avoid.
            order = np.argsort(cols)
            sub = ds[variables].isel(symbol=cols[order])
            if "teo" in ds.dims:
                sub = sub.isel(teo=slice(-window_teos, None))
            block = np.stack([
                np.nan_to_num(np.asarray(sub[v].values, dtype=np.float32), nan=0.0)
                for v in variables
            ])
            # Undo the sort so block columns line up with `sel` order again.
            inverse = np.argsort(order)
        except Exception:
            continue
        touched = True
        # Axis order varies by store; put symbol last so a per-ticker slice is contiguous.
        sym_axis = next(
            (a for a, d in enumerate(sub[variables[0]].dims, start=1) if d == "symbol"), None
        )
        if sym_axis is None:
            continue
        block = np.moveaxis(block, sym_axis, -1)
        tag = f"{store.name}:{','.join(variables)}".encode()
        for pos, (tkr, _) in enumerate(sel):
            h = per_ticker[tkr]
            h.update(tag)
            h.update(np.ascontiguousarray(block[..., inverse[pos]]).tobytes())

    if not touched:
        return {}
    gdigest = global_part.digest()
    return {t: hashlib.blake2b(h.digest() + gdigest, digest_size=16).hexdigest() for t, h in per_ticker.items()}


def load_fingerprint_manifest(out_root: Path) -> dict[str, str]:
    path = Path(out_root) / FINGERPRINT_MANIFEST
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text())
        return {str(k): str(v) for k, v in data.items()} if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_fingerprint_manifest(out_root: Path, manifest: dict[str, str]) -> None:
    try:
        (Path(out_root) / FINGERPRINT_MANIFEST).write_text(
            json.dumps(dict(sorted(manifest.items())), indent=0)
        )
    except OSError:
        pass


def _fingerprint_skip_row(out_root: Path, ticker: str) -> dict:
    """Log row for a ticker whose inputs are byte-identical to its last render."""
    tdir = Path(out_root) / ticker
    return {
        "ticker": ticker,
        "status": "skipped_resume",
        "duration_s": 0.0,
        "png": str(tdir / f"{ticker}_DD_latest.png"),
        "pdf": str(tdir / f"{ticker}_DD_latest.pdf"),
        "skip_reason": "fingerprint_unchanged",
    }


def _outputs_are_current(png: Path, pdf: Path, inputs_mtime: float) -> bool:
    """True when both outputs exist and post-date the inputs."""
    try:
        if not (png.is_file() and pdf.is_file()):
            return False
        if inputs_mtime <= 0:
            return True  # freshness unknown — preserve legacy resume behaviour
        return min(png.stat().st_mtime, pdf.stat().st_mtime) >= inputs_mtime
    except OSError:
        return False


class RenderTimeout(Exception):
    """A single ticker exceeded its render budget."""


def _raise_render_timeout(signum, frame):
    raise RenderTimeout("render exceeded its per-ticker budget")


def _arm_render_timeout(seconds: int) -> None:
    """Start a SIGALRM deadline for this ticker, inside the worker process.

    Enforced in the worker rather than by cancelling the future: a
    ProcessPoolExecutor future that has already started cannot be cancelled, and
    the pool's shutdown waits for it, so an executor-level deadline still hangs at
    exit. Raising here frees the slot and returns an ordinary error row, letting
    the run finish and — critically — the batch upload proceed.

    Guards an observed failure: a 1,000-ticker run reached 999 and then sat ~48
    minutes with every worker at 0% CPU and one future that never returned,
    silently withholding the publish. That ticker rendered fine on retry, so the
    stall is transient and will recur.

    No-ops where SIGALRM is unavailable (non-Unix) or unusable (not the main
    thread), degrading to the previous behaviour rather than failing the render.
    """
    if seconds <= 0 or not hasattr(signal, "SIGALRM"):
        return
    try:
        signal.signal(signal.SIGALRM, _raise_render_timeout)
        signal.alarm(seconds)
    except ValueError:  # not the main thread of this process
        pass


def _disarm_render_timeout() -> None:
    if not hasattr(signal, "SIGALRM"):
        return
    try:
        signal.alarm(0)
    except ValueError:
        pass


# -----------------------------------------------------------------------------
# Per-ticker render
# -----------------------------------------------------------------------------

def _render_one(
    ticker: str,
    out_root: Path,
    zarr_root: Path,
    *,
    upload_gcs: bool,
    gcs_bucket: str,
    resume: bool,
    force: bool = False,
    renderer: str = "public",
    panels: bool = False,
    panels_gcs_root: str | None = None,
    inputs_mtime: float = 0.0,
    timeout_s: int = 0,
) -> dict:
    """Render one ticker's DD to PNG + PDF. Returns a status dict for the log.

    ``upload_gcs`` controls *per-ticker* upload only. Set it to False and use
    ``--upload-mode batch`` in :func:`main` when running at scale — ``gcloud
    storage rsync`` of the whole output tree is several × faster than N×2
    invocations of ``gcloud storage cp``.

    ``renderer``: ``"public"`` (default) routes through the public
    ``riskmodels.snapshots.reference_renderer`` (no narrative). ``"institutional"``
    routes through ``bwmacro.snapshots.stock.stock_deep_dive`` (full editorial
    layout with optional ``Judgment`` from ``bwmacro.risk_interpretation``).
    Requires the ``bwmacro`` package to be importable from the current venv —
    intended for BWMACRO-driven Dagster runs (``DD_Snapshots`` code location).
    """
    if renderer == "institutional":
        from bwmacro.risk_interpretation import derive_judgment
        from bwmacro.snapshots.stock.stock_deep_dive import (
            DDData,
            render_dd_to_pdf,
            render_dd_to_png,
        )
    else:
        from riskmodels.snapshots.canonical import from_components
        from riskmodels.snapshots.reference_renderer import (
            render_canonical_to_pdf,
            render_canonical_to_png,
        )
    from riskmodels.snapshots.zarr_context import build_p1_from_zarr
    from riskmodels.snapshots.zarr_peer_analytics import (
        build_peer_comparison_from_zarr,
        compute_peer_analytics_from_zarr,
    )

    t0 = time.perf_counter()
    tdir = out_root / ticker
    png = tdir / f"{ticker}_DD_latest.png"
    pdf = tdir / f"{ticker}_DD_latest.pdf"

    if resume and not force and _outputs_are_current(png, pdf, inputs_mtime):
        return {
            "ticker": ticker,
            "status": "skipped_resume",
            "duration_s": 0.0,
            "png": str(png),
            "pdf": str(pdf),
        }

    try:
        _arm_render_timeout(timeout_s)
        p1 = build_p1_from_zarr(ticker, zarr_root)

        peer_comparison = None
        peer_error: str | None = None
        peer_correlations: dict = {}
        peer_sharpes: dict = {}
        alpha_trajectory: list = []
        peer_rankings: dict = {}
        # Zarr-only peer path — no HTTP calls, no rate limits, no billing.
        try:
            peer_comparison = build_peer_comparison_from_zarr(ticker, zarr_root)
        except Exception as exc:
            peer_error = f"peer_discovery: {type(exc).__name__}: {exc}"[:400]
        if peer_comparison is not None and not peer_comparison.peer_detail.empty:
            try:
                peer_correlations, peer_sharpes, peer_rankings, alpha_trajectory = (
                    compute_peer_analytics_from_zarr(ticker, zarr_root, peer_comparison)
                )
            except Exception as exc:
                peer_error = (peer_error + " | " if peer_error else "") + (
                    f"analytics: {type(exc).__name__}: {exc}"[:400]
                )

        tdir.mkdir(parents=True, exist_ok=True)
        panel_status: dict | None = None
        with _MATPLOTLIB_RENDER_LOCK:
            if renderer == "institutional":
                dd = DDData(
                    p1=p1,
                    peer_comparison=peer_comparison,
                    peer_correlations=peer_correlations,
                    peer_sharpes=peer_sharpes,
                    peer_rankings=peer_rankings,
                    alpha_trajectory=alpha_trajectory,
                    company_profile_text=None,
                )
                try:
                    judgment = derive_judgment(dd)
                except Exception:
                    judgment = None
                render_dd_to_png(dd, png, judgment=judgment)
                render_dd_to_pdf(dd, pdf, judgment=judgment)
                # Same DDData, same lock (matplotlib is not thread-safe) —
                # panel pixels match the letter page by construction.
                panel_status = _emit_dd_panels(dd, tdir, ticker, panels_gcs_root) if panels else None
            else:
                snap = from_components(
                    p1,
                    peer_comparison=peer_comparison,
                    peer_rankings=peer_rankings,
                )
                render_canonical_to_png(snap, png)
                render_canonical_to_pdf(snap, pdf)

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

        out: dict = {
            "ticker": ticker,
            "status": "ok",
            "duration_s": round(time.perf_counter() - t0, 2),
            "png": str(png),
            "pdf": str(pdf),
            "uploaded": uploaded,
            "has_peers": peer_comparison is not None,
            "n_peer_corrs": len(peer_correlations),
            "n_peer_sharpes": len(peer_sharpes),
            "n_alpha_traj": len(alpha_trajectory),
        }
        if peer_error:
            out["peer_error"] = peer_error
        if panel_status is not None:
            out["panels"] = panel_status
        return out
    except Exception as exc:
        return {
            "ticker": ticker,
            "status": "error",
            "duration_s": round(time.perf_counter() - t0, 2),
            "error": str(exc),
            "traceback": traceback.format_exc().splitlines()[-3:],
        }
    finally:
        _disarm_render_timeout()


# DD registry panels emitted per ticker when --panels is on (institutional
# renderer only — they consume the same in-memory DDData as the letter page,
# so panel pixels match the page by construction). Keys mirror render-svc's
# artifact cache (`{root}/artifacts/{slug}@{version}/{subject_id}/{as_of}.{fmt}`)
# plus a `latest.*` alias so `as_of=latest` resolves without a loader.
# See BWMACRO docs/ceo/DD_PANEL_REGISTRY_EXPOSE_PROJECT.md (Tier-1 cohort).
_DD_PANEL_SLUGS: tuple[tuple[str, str], ...] = (
    ("dd_peer_dna", "v1"),
)


def _emit_dd_panels(
    dd,
    tdir: Path,
    ticker: str,
    panels_gcs_root: str | None,
) -> dict:
    """Render + upload registry DD panels from the in-memory ``DDData``.

    Returns a status dict folded into the ticker row: per-slug ok/error,
    upload state. Never raises — a panel failure must not fail the page
    render that already succeeded.
    """
    import importlib
    import json as _json

    teo = dd.teo
    subject_id = f"BW-STOCK-{ticker}"
    status: dict = {"emitted": [], "errors": {}}
    for slug, version in _DD_PANEL_SLUGS:
        try:
            mod = importlib.import_module(f"bwmacro.snapshots.artifacts.{slug}.{version}")
            png = mod.render_png_bytes(dd)
            data = _json.dumps(mod.render_data(dd), separators=(",", ":")).encode("utf-8")

            local_dir = tdir / "panels" / f"{slug}@{version}"
            local_dir.mkdir(parents=True, exist_ok=True)
            (local_dir / f"{teo}.png").write_bytes(png)
            (local_dir / f"{teo}.json").write_bytes(data)

            if panels_gcs_root:
                key_root = f"{panels_gcs_root.rstrip('/')}/artifacts/{slug}@{version}/{subject_id}"
                for fmt in ("png", "json"):
                    local = local_dir / f"{teo}.{fmt}"
                    for key in (f"{teo}.{fmt}", f"latest.{fmt}"):
                        subprocess.run(
                            ["gcloud", "storage", "cp", str(local), f"{key_root}/{key}"],
                            check=True, capture_output=True, text=True,
                        )
            status["emitted"].append(f"{slug}@{version}")
        except subprocess.CalledProcessError as e:
            status["errors"][f"{slug}@{version}"] = f"upload: {e.stderr}"[:300]
        except Exception as exc:  # noqa: BLE001 — panel failure must not fail the page
            status["errors"][f"{slug}@{version}"] = f"{type(exc).__name__}: {exc}"[:300]
    return status


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
    ap.add_argument(
        "--api-peers", action="store_true",
        help=(
            "[Deprecated, no-op] Peer discovery + analytics are now always "
            "sourced from local zarr (no HTTP, no rate limits). Kept for "
            "backwards compatibility with existing Dagster env-var wiring."
        ),
    )
    ap.add_argument(
        "--upload-gcs",
        action="store_true",
        help=(
            "Alias for --upload-mode per-ticker. Upload each ticker PNG+PDF to "
            "GCS as it finishes. For 1k+ runs prefer --upload-mode batch."
        ),
    )
    ap.add_argument(
        "--upload-mode",
        choices=["none", "per-ticker", "batch"],
        default=None,
        help=(
            "GCS upload strategy. 'none' keeps artifacts local. 'per-ticker' "
            "uploads after each render (live propagation, slow at scale). "
            "'batch' skips per-ticker uploads and runs one gcloud storage "
            "rsync over the whole out_dir at the end (much faster for 1k+). "
            "If unset, defaults to 'per-ticker' when --upload-gcs is on, else 'none'."
        ),
    )
    ap.add_argument("--gcs-bucket", default="gs://rm_api_public/snapshot")
    parser.add_argument(
        "--ticker-timeout", type=int, default=300,
        help="Per-ticker render budget in seconds (0 disables). A stuck ticker "
             "otherwise holds a pool slot forever and blocks the batch upload.",
    )
    ap.add_argument("--resume", action="store_true",
                    help="Skip tickers whose PNG+PDF already exist in --out-dir.")
    ap.add_argument(
        "--force",
        action="store_true",
        help="Re-render even when PNG+PDF already exist (overwrites). "
             "With --resume, disables skip-on-existing so all tickers are regenerated "
             "(typical after a snapshot layout change).",
    )
    ap.add_argument(
        "--limit",
        type=int,
        default=None,
        help=(
            "Cap the run to N tickers. When a --universe is used, the N kept "
            "are the top-N by market_cap (from ds_daily.zarr) rather than the "
            "alphabetical first N."
        ),
    )
    ap.add_argument(
        "--workers",
        type=int,
        default=1,
        help=(
            "Thread pool size for ticker jobs (default 1). Each task loads zarr "
            "peer context in parallel, but matplotlib snapshots are serialized "
            "with an internal lock (pyplot is not thread-safe). Use 4–8 to "
            "overlap I/O without expecting linear speedups on PNG/PDF throughput."
        ),
    )
    ap.add_argument(
        "--renderer",
        choices=["public", "institutional"],
        default="public",
        help=(
            "Renderer to use. 'public' (default) → public SDK reference_renderer "
            "(no narrative, OSS-safe). 'institutional' → BWMACRO private "
            "stock_deep_dive renderer with full editorial layout + Judgment "
            "from bwmacro.risk_interpretation. Requires the 'bwmacro' package "
            "to be importable from the venv (used by the BWMACRO Dagster "
            "DD_Snapshots code location)."
        ),
    )
    ap.add_argument(
        "--panels",
        action="store_true",
        help=(
            "Also emit registry DD panels (dd_peer_dna@v1, …) per ticker from "
            "the same in-memory DDData as the letter page, and upload them to "
            "the render-svc artifact cache keys (+ a latest.* alias). "
            "Institutional renderer only. Intended for the Tier-1 hot cohort "
            "(~100 tickers, ~seconds/ticker marginal) — see BWMACRO "
            "docs/ceo/DD_PANEL_REGISTRY_EXPOSE_PROJECT.md before running it "
            "over a full universe."
        ),
    )
    ap.add_argument(
        "--panels-gcs-root",
        default="gs://rm_api_data/snapshots",
        help=(
            "GCS root for panel artifact keys "
            "({root}/artifacts/{slug}@{version}/BW-STOCK-{T}/{as_of}.{fmt}). "
            "Must match render-svc RENDER_SVC_BUCKET/RENDER_SVC_PREFIX. "
            "Pass an empty string to keep panels local-only."
        ),
    )
    ap.add_argument("--dry-run", action="store_true",
                    help="Resolve the ticker list, print the count + first 10, exit.")
    args = ap.parse_args()

    if args.panels and args.renderer != "institutional":
        print("FAIL: --panels requires --renderer institutional (panels wrap the "
              "private DDData figure units)", file=sys.stderr)
        return 2

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
        if source.startswith("zarr:"):
            tickers = _cap_rank_tickers(args.zarr_root, tickers)[: args.limit]
        else:
            tickers = tickers[: args.limit]

    upload_mode = args.upload_mode
    if upload_mode is None:
        upload_mode = "per-ticker" if args.upload_gcs else "none"

    workers = max(1, int(args.workers or 1))

    if args.dry_run:
        print(f"source: {source}")
        print(f"out_dir: {args.out_dir}")
        print(f"count: {len(tickers)}")
        print(f"first 10: {tickers[:10]}")
        return 0

    if not args.out_dir.parent.is_dir() and not args.out_dir.is_dir():
        print(f"FAIL: --out-dir parent does not exist: {args.out_dir.parent} "
              f"(is /Volumes/ext_2t mounted?)")
        return 2
    args.out_dir.mkdir(parents=True, exist_ok=True)

    # ── Run ── (peer discovery + analytics are zarr-only, no API calls)
    t_start = time.perf_counter()
    log_path = args.out_dir / "_bulk_run_log.jsonl"
    summary_path = args.out_dir / "_bulk_summary.json"

    counts = {"ok": 0, "skipped_resume": 0, "error": 0, "uploaded_partial": 0}
    print("=== bulk_dd_render ===")
    print(f"  source       : {source}")
    print(f"  count        : {len(tickers)}")
    print(f"  out_dir      : {args.out_dir}")
    print(f"  zarr_root    : {args.zarr_root}")
    print(f"  peers        : zarr (no API)")
    print(f"  upload_mode  : {upload_mode}")
    print(f"  workers      : {workers}")
    print(f"  ticker_tmout : {args.ticker_timeout}s")
    print(f"  resume       : {args.resume}")
    print(f"  force        : {args.force}")
    # Under --resume a ticker is re-rendered when its outputs predate this.
    inputs_mtime = input_mtime(args.zarr_root)
    print(
        f"  inputs as-of : "
        + (
            datetime.fromtimestamp(inputs_mtime, timezone.utc).isoformat(timespec="seconds")
            if inputs_mtime
            else "unknown (resume falls back to existence check)"
        )
    )
    print(f"  renderer     : {args.renderer}")

    # Per-ticker staleness. The timestamp above says "something changed"; the
    # digests say "changed FOR THIS TICKER", so a rebuild that corrected a
    # handful of names re-renders those names instead of the whole universe.
    fingerprints: dict[str, str] = {}
    fp_manifest: dict[str, str] = {}
    fresh: set[str] = set()
    if args.resume and not args.force:
        fp_t0 = time.perf_counter()
        try:
            fingerprints = symbol_fingerprints(args.zarr_root, tickers)
        except Exception as exc:  # never let the optimisation break the run
            print(f"  fingerprints : unavailable ({exc}) — falling back to timestamp gate")
            fingerprints = {}
        if fingerprints:
            fp_manifest = load_fingerprint_manifest(args.out_dir)
            for t in tickers:
                tdir = args.out_dir / t
                if not (tdir / f"{t}_DD_latest.png").is_file():
                    continue
                if not (tdir / f"{t}_DD_latest.pdf").is_file():
                    continue
                if fp_manifest.get(t) and fp_manifest[t] == fingerprints.get(t):
                    fresh.add(t)
            print(
                f"  fingerprints : {len(fingerprints)} computed in "
                f"{time.perf_counter() - fp_t0:.1f}s — {len(fresh)} unchanged, "
                f"{len(tickers) - len(fresh)} to render"
            )
    print()

    total = len(tickers)
    per_ticker_upload = (upload_mode == "per-ticker")

    # tqdm: one updating progress line + inline error pings via pbar.write.
    # `mininterval=2.0` keeps the captured Dagster log readable
    # (~30 update lines per hour instead of 1000+ per-ticker prints).
    is_tty = sys.stdout.isatty()
    use_pbar = tqdm is not None
    pbar = (
        tqdm(
            total=total,
            desc="DD render",
            unit="tk",
            smoothing=0.1,
            mininterval=2.0 if not is_tty else 0.5,
            ncols=100,
            ascii=not is_tty,  # plain ASCII in non-TTY (Dagster log capture)
        )
        if use_pbar
        else None
    )

    def _log_result(row: dict, i: int, logf) -> None:
        """Record one ticker's result — counts, jsonl row, progress bar.

        Always called from the main process only (workers, whether threads or
        processes, never touch logf/counts/pbar directly) — so no lock is needed.
        """
        row["i"] = i
        row["ts"] = datetime.now(timezone.utc).isoformat()
        ticker = row.get("ticker", "?")
        counts[row["status"]] = counts.get(row["status"], 0) + 1
        # Record the digest only on a render that actually succeeded, so a failed
        # or partial ticker stays stale and is retried on the next run.
        if row["status"] in ("ok", "uploaded_partial") and ticker in fingerprints:
            fp_manifest[ticker] = fingerprints[ticker]
        logf.write(json.dumps(row) + "\n")
        logf.flush()
        if pbar is not None:
            pbar.update(1)
            pbar.set_postfix(
                ok=counts["ok"], skip=counts["skipped_resume"], err=counts["error"],
                last=ticker, refresh=False,
            )
            if row["status"] == "error":
                pbar.write(f"  ✗ {ticker}: {(row.get('error') or '')[:120]}")
        else:
            tag = {"ok": "✓", "skipped_resume": "⤳", "error": "✗",
                   "uploaded_partial": "⚠"}.get(row["status"], "?")
            extra = f" ({row['duration_s']}s)" if row.get("duration_s") else ""
            err = f" — {row.get('error','')}" if row["status"] == "error" else ""
            print(f"  [{i:>4}/{total}] {tag} {ticker}{extra}{err}", flush=True)

    with log_path.open("w") as logf:
        if workers <= 1:
            for i, ticker in enumerate(tickers, start=1):
                if ticker in fresh:
                    _log_result(_fingerprint_skip_row(args.out_dir, ticker), i, logf)
                    continue
                row = _render_one(
                    ticker, args.out_dir, args.zarr_root,
                    upload_gcs=per_ticker_upload, gcs_bucket=args.gcs_bucket,
                    resume=args.resume, force=args.force, renderer=args.renderer,
                    panels=args.panels, panels_gcs_root=args.panels_gcs_root or None,
                    inputs_mtime=inputs_mtime, timeout_s=args.ticker_timeout,
                )
                _log_result(row, i, logf)
        else:
            # ProcessPoolExecutor, not threads: rendering is CPU-bound (matplotlib/
            # Pillow compositing), so threads mostly contend for the GIL instead of
            # using multiple cores — measured ~1.25x effective speedup at workers=8
            # with threads vs. genuine ~Nx with processes. Workers here own no
            # shared state (logf/counts/pbar are main-process-only, updated as each
            # future completes below), so there's nothing to pickle across the
            # process boundary except _render_one's plain str/Path/bool arguments.
            with ProcessPoolExecutor(max_workers=workers) as ex:
                for i, t in enumerate(tickers, start=1):
                    if t in fresh:
                        _log_result(_fingerprint_skip_row(args.out_dir, t), i, logf)
                futs = {
                    ex.submit(
                        _render_one, t, args.out_dir, args.zarr_root,
                        upload_gcs=per_ticker_upload, gcs_bucket=args.gcs_bucket,
                        resume=args.resume, force=args.force, renderer=args.renderer,
                        panels=args.panels, panels_gcs_root=args.panels_gcs_root or None,
                        inputs_mtime=inputs_mtime, timeout_s=args.ticker_timeout,
                    ): (i, t)
                    for i, t in enumerate(tickers, start=1)
                }
                # _render_one already catches everything it can raise internally,
                # but a worker-process crash (e.g. killed for OOM) must never vanish
                # silently — .result() forces that to surface as an error row
                # instead of a ticker just disappearing from the counts.
                for fut in as_completed(futs):
                    i, ticker = futs[fut]
                    try:
                        row = fut.result()
                    except Exception as exc:
                        row = {
                            "ticker": ticker,
                            "status": "error",
                            "error": f"{type(exc).__name__}: {exc}",
                            "traceback": traceback.format_exc().splitlines()[-5:],
                        }
                    _log_result(row, i, logf)

    if pbar is not None:
        pbar.close()

    batch_upload: dict | None = None
    if upload_mode == "batch":
        print()
        print("=== batch upload (gcloud storage rsync) ===")
        ok, msg = _rsync_out_dir_to_gcs(args.out_dir, args.gcs_bucket)
        tail = msg[-2000:] if msg else ""
        batch_upload = {"ok": ok, "output_tail": tail}
        if tail:
            print(tail)
        if not ok:
            print("BATCH UPLOAD FAILED — see output_tail above / _bulk_summary.json.")

    duration = round(time.perf_counter() - t_start, 1)
    summary = {
        "started_at_utc": datetime.now(timezone.utc).isoformat(),
        "duration_s": duration,
        "count_total": len(tickers),
        "counts": counts,
        "source": source,
        "out_dir": str(args.out_dir),
        "zarr_root": str(args.zarr_root),
        "api_peers": False,
        "peer_source": "zarr",
        "upload_mode": upload_mode,
        "upload_gcs": args.upload_gcs,
        "workers": workers,
        "resume": args.resume,
        "force": args.force,
        "log_file": str(log_path),
    }
    if batch_upload is not None:
        summary["batch_upload"] = batch_upload
    summary_path.write_text(json.dumps(summary, indent=2))

    # Written after the batch upload so a ticker is only recorded as current once
    # its outputs are actually published; an interrupted run simply re-renders.
    if fp_manifest:
        save_fingerprint_manifest(args.out_dir, fp_manifest)

    print()
    print("=== Summary ===")
    print(f"  duration : {duration}s")
    for k, v in counts.items():
        print(f"  {k:<18}: {v}")
    print(f"  log      : {log_path}")
    print(f"  summary  : {summary_path}")
    exit_ok = counts.get("error", 0) == 0 and (batch_upload is None or batch_upload.get("ok"))
    return 0 if exit_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
