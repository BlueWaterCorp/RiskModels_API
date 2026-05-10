#!/usr/bin/env python3
"""Bulk canonical-snapshot renderer — P1 (and later F1/C1) → GCS pre-render batch.

For each ticker in the requested universe, this script:

  1. Builds ``P1Data`` from the local zarr stack.
  2. Composes a ``CanonicalStockSnapshot`` via ``from_components``.
  3. Runs the **full 9-gate contract** (``contract_check.check_one``).
  4. On pass — writes the canonical JSON + reference-rendered PDF + PNG to
     ``gs://{bucket}/{prefix}/p1/{YYYY-MM}/{TICKER}.{json|pdf|png}``.
  5. On fail — logs, skips, leaves any prior-month artifact untouched.

Companion to ``bulk_dd_render.py``, which serves the legacy DD-style
premium output at ``gs://rm_api_public/snapshot/{TICKER}/``. The two
pipelines coexist (Option A in CANONICAL_INTELLIGENCE_OBJECTS.md ownership).

Usage
-----
::

    # Smoke (tiny universe + skip GCS):
    PYTHONPATH=sdk python sdk/scripts/bulk_canonical_render.py \\
        --tickers NVDA AAPL --no-upload

    # Full top-1000 universe → GCS:
    PYTHONPATH=sdk python sdk/scripts/bulk_canonical_render.py \\
        --universe uni_mc_1000 --upload-gcs

    # Resume after a crash:
    PYTHONPATH=sdk python sdk/scripts/bulk_canonical_render.py \\
        --universe uni_mc_1000 --upload-gcs --resume

Env (overrides CLI defaults):
    ERM3_ZARR_ROOT           — zarr root path; required when not provided via CLI.
    BULK_CANONICAL_OUT_DIR   — local staging dir (default: tempdir).
    BULK_CANONICAL_BUCKET    — GCS bucket (default: ``gs://rm_api_data``).
    BULK_CANONICAL_PREFIX    — GCS prefix (default: ``snapshots``).
    BULK_CANONICAL_GENERATED_UTC — pinned generated_utc; default = today's UTC anchor.
"""

from __future__ import annotations

import matplotlib as _matplotlib

_matplotlib.use("Agg")  # headless before any pyplot import

import argparse
import json
import logging
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

log = logging.getLogger("bulk_canonical_render")


def _default_zarr_root() -> Path | None:
    raw = os.environ.get("ERM3_ZARR_ROOT")
    return Path(raw).expanduser().resolve() if raw else None


def _default_bucket() -> str:
    return os.environ.get("BULK_CANONICAL_BUCKET", "gs://rm_api_data")


def _default_prefix() -> str:
    return os.environ.get("BULK_CANONICAL_PREFIX", "snapshots")


def _default_generated_utc() -> str:
    """Trading-day close anchor (16:00 ET) for the current date in UTC.

    Override via ``BULK_CANONICAL_GENERATED_UTC`` for batch reproducibility.
    """
    raw = os.environ.get("BULK_CANONICAL_GENERATED_UTC")
    if raw:
        return raw
    # 16:00 US/Eastern ≈ 20:00-21:00 UTC depending on DST. Use 20:00Z as a
    # stable approximation; production sets the precise value via env.
    today = datetime.now(timezone.utc).date().isoformat()
    return f"{today}T20:00:00+00:00"


def _resolve_tickers_universe(zarr_root: Path, universe: str) -> list[str]:
    """Read the universe mask from ``ds_masks.zarr`` and return ticker list."""
    import xarray as xr

    masks = xr.open_zarr(str(zarr_root / "ds_masks.zarr"))
    if universe not in masks.data_vars:
        raise ValueError(
            f"universe {universe!r} not found in ds_masks.zarr; "
            f"available: {sorted(masks.data_vars)}"
        )
    mask = masks[universe].isel(teo=-1)  # latest TEO
    selected = mask.where(mask, drop=True).symbol.values
    return [str(s) for s in selected]


def _gcs_path(prefix: str, ticker: str, as_of: str, ext: str) -> str:
    """``snapshots/p1/{YYYY-MM}/{TICKER}.{ext}``"""
    yyyy_mm = as_of[:7]
    return f"{prefix}/p1/{yyyy_mm}/{ticker}.{ext}"


def _gcs_upload(bucket: str, gcs_relpath: str, local_path: Path) -> None:
    """``gcloud storage cp`` wrapper. Errors propagate to the caller."""
    full = f"{bucket}/{gcs_relpath}"
    subprocess.run(
        ["gcloud", "storage", "cp", str(local_path), full, "--quiet"],
        check=True,
        capture_output=True,
    )


def _gcs_exists(bucket: str, gcs_relpath: str) -> bool:
    full = f"{bucket}/{gcs_relpath}"
    try:
        subprocess.run(
            ["gcloud", "storage", "ls", full],
            check=True,
            capture_output=True,
        )
        return True
    except subprocess.CalledProcessError:
        return False


def _all_already_uploaded(bucket: str, prefix: str, ticker: str, as_of: str) -> bool:
    return all(
        _gcs_exists(bucket, _gcs_path(prefix, ticker, as_of, ext))
        for ext in ("json", "pdf", "png")
    )


def _render_one(
    *,
    ticker: str,
    zarr_root: Path,
    as_of: str,
    generated_utc: str,
    out_dir: Path,
) -> tuple[Path, Path, Path]:
    """Build canonical → run gate → render → return (json_path, pdf_path, png_path).

    Raises on gate failure or render error so the caller can log + skip.
    """
    from riskmodels.snapshots import (
        from_components,
        render_canonical_to_pdf,
        render_canonical_to_png,
    )
    from riskmodels.snapshots.contract_check import check_one
    from riskmodels.snapshots.zarr_context import build_p1_from_zarr

    p1 = build_p1_from_zarr(ticker=ticker, zarr_root=zarr_root, as_of_date=as_of)
    snap = from_components(p1, generated_utc=generated_utc)

    # Stage canonical JSON to disk so check_one can read it (mirrors the CLI gate).
    ticker_dir = out_dir / ticker
    ticker_dir.mkdir(parents=True, exist_ok=True)
    json_path = ticker_dir / f"{ticker}.json"
    snap.to_json(json_path)

    # Full 9-gate contract — the gate that the live render's fast subset skips.
    # We need it here because this is the production batch publishing
    # immutable artifacts.
    p1_cache_path = ticker_dir / f"{ticker}_p1_cache.json"
    p1.to_json(p1_cache_path)
    ok, failures = check_one(p1_cache_path, generated_utc=generated_utc)
    if not ok:
        raise RuntimeError(f"contract gate failed: {failures}")

    pdf_path = ticker_dir / f"{ticker}.pdf"
    png_path = ticker_dir / f"{ticker}.png"
    render_canonical_to_pdf(snap, pdf_path)
    render_canonical_to_png(snap, png_path)

    return json_path, pdf_path, png_path


def _process_ticker(
    *,
    ticker: str,
    zarr_root: Path,
    as_of: str,
    generated_utc: str,
    out_dir: Path,
    bucket: str,
    prefix: str,
    upload: bool,
    resume: bool,
) -> dict[str, Any]:
    t0 = time.monotonic()
    record: dict[str, Any] = {
        "ticker": ticker, "as_of": as_of, "generated_utc": generated_utc,
    }

    if resume and upload and _all_already_uploaded(bucket, prefix, ticker, as_of):
        record["status"] = "skipped_resume"
        record["duration_s"] = round(time.monotonic() - t0, 3)
        return record

    try:
        json_path, pdf_path, png_path = _render_one(
            ticker=ticker, zarr_root=zarr_root, as_of=as_of,
            generated_utc=generated_utc, out_dir=out_dir,
        )
    except Exception as exc:  # noqa: BLE001
        record["status"] = "failed"
        record["error"] = f"{type(exc).__name__}: {exc}"
        record["duration_s"] = round(time.monotonic() - t0, 3)
        return record

    if upload:
        try:
            for path, ext in [(json_path, "json"), (pdf_path, "pdf"), (png_path, "png")]:
                _gcs_upload(bucket, _gcs_path(prefix, ticker, as_of, ext), path)
        except subprocess.CalledProcessError as exc:
            record["status"] = "uploaded_partial"
            record["error"] = f"gcs upload failed: {exc.stderr.decode(errors='replace') if exc.stderr else exc}"
            record["duration_s"] = round(time.monotonic() - t0, 3)
            return record

    record["status"] = "ok"
    record["duration_s"] = round(time.monotonic() - t0, 3)
    return record


def _resolve_tickers_input(args: argparse.Namespace, zarr_root: Path) -> list[str]:
    if args.tickers:
        return [t.upper() for t in args.tickers]
    if args.tickers_file:
        return [
            line.strip().upper() for line in Path(args.tickers_file).read_text().splitlines()
            if line.strip() and not line.startswith("#")
        ]
    return _resolve_tickers_universe(zarr_root, args.universe)


def _setup_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s — %(message)s",
        datefmt="%H:%M:%S",
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--zarr-root", type=Path, default=_default_zarr_root())
    ap.add_argument("--tickers", nargs="+", help="Explicit tickers (overrides universe).")
    ap.add_argument("--tickers-file", type=Path, help="One ticker per line.")
    ap.add_argument("--universe", default="uni_mc_1000",
                    help="Universe key in ds_masks.zarr (default: uni_mc_1000).")
    ap.add_argument("--limit", type=int, default=None,
                    help="Cap number of tickers (useful for smoke tests).")
    ap.add_argument("--bucket", default=_default_bucket(),
                    help=f"GCS bucket (default: {_default_bucket()}).")
    ap.add_argument("--prefix", default=_default_prefix(),
                    help=f"GCS prefix (default: {_default_prefix()}).")
    ap.add_argument("--as-of", default=None,
                    help="Override as_of date; default = today (UTC).")
    ap.add_argument("--generated-utc", default=_default_generated_utc(),
                    help="Pinned generated_utc anchor for batch byte-stability.")
    ap.add_argument("--out-dir", type=Path, default=None,
                    help="Local staging dir (default: tempfile.mkdtemp).")
    ap.add_argument("--upload-gcs", dest="upload", action="store_true", default=False)
    ap.add_argument("--no-upload", dest="upload", action="store_false")
    ap.add_argument("--resume", action="store_true",
                    help="Skip tickers whose 3 artifacts are already in GCS.")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args(argv)

    _setup_logging(args.verbose)

    if args.zarr_root is None:
        log.error("--zarr-root or ERM3_ZARR_ROOT is required")
        return 2

    if args.out_dir is None:
        args.out_dir = Path(tempfile.mkdtemp(prefix="bulk_canonical_"))
    args.out_dir.mkdir(parents=True, exist_ok=True)

    as_of = args.as_of or datetime.now(timezone.utc).date().isoformat()

    tickers = _resolve_tickers_input(args, args.zarr_root)
    if args.limit is not None:
        tickers = tickers[: args.limit]

    log.info("rendering %d tickers; as_of=%s; out_dir=%s; upload=%s",
             len(tickers), as_of, args.out_dir, args.upload)

    log_path = args.out_dir / "_bulk_run_log.jsonl"
    summary = {"started_at": datetime.now(timezone.utc).isoformat(),
               "ticker_count": len(tickers), "as_of": as_of, "ok": 0,
               "failed": 0, "skipped_resume": 0, "uploaded_partial": 0}

    with log_path.open("w") as logfh:
        for i, ticker in enumerate(tickers, 1):
            rec = _process_ticker(
                ticker=ticker, zarr_root=args.zarr_root, as_of=as_of,
                generated_utc=args.generated_utc, out_dir=args.out_dir,
                bucket=args.bucket, prefix=args.prefix,
                upload=args.upload, resume=args.resume,
            )
            logfh.write(json.dumps(rec) + "\n")
            logfh.flush()
            summary[rec["status"]] = summary.get(rec["status"], 0) + 1
            log.info("[%d/%d] %s: %s (%.2fs)", i, len(tickers), ticker,
                     rec["status"], rec["duration_s"])

    summary["finished_at"] = datetime.now(timezone.utc).isoformat()
    (args.out_dir / "_bulk_summary.json").write_text(json.dumps(summary, indent=2))

    log.info("done: %s", summary)
    return 0 if summary["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
