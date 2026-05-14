#!/usr/bin/env python3
"""Bulk F1 institutional tearsheet PNGs for 13F filers (BWMACRO Matplotlib).

Writes flat filenames for CDN probing (`riskmodels.app/snapshots/{bw_filer_id}_f1.png`):

    {out_dir}/BW-FILER-CIK..._f1.png

Prerequisites
-------------
- BWMACRO monorepo venv (imports ``bwmacro.snapshots.filers``).
- ``FUNDS_DAG_ZARR_ROOT`` pointing at the directory that **contains**
  ``bw_filer_id/`` (same convention as ``bwmacro.snapshots.filers._data``).

PYTHONPATH must include ``sdk`` plus ``BWMACRO/src`` (see ``run_bulk_filer_f1.sh``).

Examples
--------
    export FUNDS_DAG_ZARR_ROOT=/path/to/Funds_DAG/data/sec_data/zarr
    PYTHONPATH=sdk:../BWMACRO/src ../BWMACRO/.venv/bin/python \\
      sdk/scripts/bulk_filer_f1_render.py \\
      --filers BW-FILER-CIK0001067983 BW-FILER-CIK0001336528 \\
      --out-dir /tmp/filer_f1_out

    # Discover every ``BW-FILER-*`` directory under the zarr root:
    PYTHONPATH=sdk:../BWMACRO/src ../BWMACRO/.venv/bin/python \\
      sdk/scripts/bulk_filer_f1_render.py --scan --upload-gcs
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

_MATPLOTLIB_RENDER_LOCK = threading.Lock()
_LOG_LOCK = threading.Lock()


def _default_out_dir() -> Path:
    if os.environ.get("BULK_SNAPSHOT_DIR"):
        return Path(os.environ["BULK_SNAPSHOT_DIR"]).expanduser().resolve()
    return Path("/Volumes/ext_2t/Filer_F1_Snapshots")


def _default_filer_parent() -> Path:
    raw = os.environ.get("FUNDS_DAG_ZARR_ROOT", "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    raise RuntimeError(
        "FUNDS_DAG_ZARR_ROOT is not set. Point it at the zarr directory "
        "that contains bw_filer_id/ (e.g. "
        "<funds_dag_root>/data/sec_data/zarr).",
    )


def _filer_root(parent: Path) -> Path:
    return parent / "bw_filer_id"


def _discover_filers(root: Path) -> list[str]:
    if not root.is_dir():
        return []
    out: list[str] = []
    for p in sorted(root.iterdir()):
        if p.is_dir() and p.name.startswith("BW-FILER-"):
            out.append(p.name)
    return out


def _filers_from_registry(path: Path) -> list[str]:
    data = json.loads(path.read_text())
    rows = data if isinstance(data, list) else data.get("rows", [])
    ids: list[str] = []
    for row in rows:
        if isinstance(row, dict):
            fid = row.get("bw_filer_id")
            if fid:
                ids.append(str(fid))
    return sorted(set(ids))


def _rsync_out_dir_to_gcs(out_dir: Path, gcs_bucket: str) -> tuple[bool, str]:
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


def _render_one(
    bw_filer_id: str,
    out_dir: Path,
    funds_dag_zarr_parent: Path,
    *,
    upload_gcs: bool,
    gcs_bucket: str,
    resume: bool,
    force: bool,
    enrich_supabase: bool,
) -> dict:
    from bwmacro.snapshots.filers.f1_filer_tearsheet import render_f1_filer_for_id

    t0 = time.perf_counter()
    png = out_dir / f"{bw_filer_id}_f1.png"

    if resume and not force and png.is_file():
        return {
            "bw_filer_id": bw_filer_id,
            "status": "skipped_resume",
            "duration_s": 0.0,
            "png": str(png),
        }

    prev_root = os.environ.get("FUNDS_DAG_ZARR_ROOT")
    os.environ["FUNDS_DAG_ZARR_ROOT"] = str(funds_dag_zarr_parent.resolve())

    try:
        with _MATPLOTLIB_RENDER_LOCK:
            render_f1_filer_for_id(
                bw_filer_id,
                png,
                fmt="png",
                enrich_supabase=enrich_supabase,
            )
        uploaded = False
        if upload_gcs:
            dest = f"{gcs_bucket.rstrip('/')}/{png.name}"
            try:
                subprocess.run(
                    ["gcloud", "storage", "cp", str(png), dest],
                    check=True,
                    capture_output=True,
                    text=True,
                )
                uploaded = True
            except subprocess.CalledProcessError as e:
                return {
                    "bw_filer_id": bw_filer_id,
                    "status": "uploaded_partial",
                    "duration_s": round(time.perf_counter() - t0, 2),
                    "png": str(png),
                    "upload_error": e.stderr,
                }
        return {
            "bw_filer_id": bw_filer_id,
            "status": "ok",
            "duration_s": round(time.perf_counter() - t0, 2),
            "png": str(png),
            "uploaded": uploaded,
        }
    except Exception as exc:
        return {
            "bw_filer_id": bw_filer_id,
            "status": "error",
            "duration_s": round(time.perf_counter() - t0, 2),
            "error": str(exc),
            "traceback": traceback.format_exc().splitlines()[-5:],
        }
    finally:
        if prev_root is None:
            os.environ.pop("FUNDS_DAG_ZARR_ROOT", None)
        else:
            os.environ["FUNDS_DAG_ZARR_ROOT"] = prev_root


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument(
        "--filer-zarr-parent",
        type=Path,
        default=None,
        help="Directory containing bw_filer_id/ (default: FUNDS_DAG_ZARR_ROOT).",
    )
    ap.add_argument("--out-dir", type=Path, default=_default_out_dir())
    ap.add_argument("--filers", nargs="*", help="Explicit bw_filer_id list.")
    ap.add_argument("--filers-file", type=Path, help="Newline-delimited bw_filer_id.")
    ap.add_argument(
        "--registry-json",
        type=Path,
        default=None,
        help="filers.json-style registry with bw_filer_id rows.",
    )
    ap.add_argument(
        "--scan",
        action="store_true",
        help="Discover all BW-FILER-* dirs under bw_filer_id/.",
    )
    ap.add_argument("--upload-gcs", action="store_true")
    ap.add_argument(
        "--upload-mode",
        choices=["none", "per-filer", "batch"],
        default=None,
    )
    ap.add_argument("--gcs-bucket", default="gs://rm_api_public/snapshot")
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument(
        "--no-supabase-enrich",
        action="store_true",
        help="Skip REST enrichment (faster bulk; stacked ER bars may be sparse).",
    )
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    parent = (
        Path(args.filer_zarr_parent).expanduser().resolve()
        if args.filer_zarr_parent
        else _default_filer_parent()
    )
    root = _filer_root(parent)

    filers: list[str] = []
    if args.filers:
        filers.extend(args.filers)
    if args.filers_file:
        filers.extend(
            ln.strip()
            for ln in args.filers_file.read_text().splitlines()
            if ln.strip()
        )
    if args.registry_json:
        filers.extend(_filers_from_registry(args.registry_json))
    if args.scan:
        filers.extend(_discover_filers(root))

    filers = sorted(set(filers))
    if args.limit is not None:
        filers = filers[: max(0, args.limit)]

    upload_mode = args.upload_mode
    if upload_mode is None:
        upload_mode = "per-filer" if args.upload_gcs else "none"

    per_upload = upload_mode == "per-filer"
    enrich_supabase = not args.no_supabase_enrich

    if args.dry_run:
        print(f"funds_dag_zarr_parent: {parent}")
        print(f"filer_root: {root}")
        print(f"count: {len(filers)}")
        print(f"first 15: {filers[:15]}")
        return 0

    if not root.is_dir():
        print(f"FAIL: filer zarr root missing: {root}", file=sys.stderr)
        return 2

    args.out_dir.mkdir(parents=True, exist_ok=True)
    workers = max(1, int(args.workers or 1))

    log_path = args.out_dir / "_bulk_run_log.jsonl"
    summary_path = args.out_dir / "_bulk_summary.json"
    counts: dict[str, int] = {"ok": 0, "skipped_resume": 0, "error": 0, "uploaded_partial": 0}

    t_start = time.perf_counter()

    def dispatch(i: int, fid: str, logf) -> None:
        row = _render_one(
            fid,
            args.out_dir,
            parent,
            upload_gcs=per_upload,
            gcs_bucket=args.gcs_bucket,
            resume=args.resume,
            force=args.force,
            enrich_supabase=enrich_supabase,
        )
        row["i"] = i
        row["ts"] = datetime.now(timezone.utc).isoformat()
        with _LOG_LOCK:
            counts[row["status"]] = counts.get(row["status"], 0) + 1
            logf.write(json.dumps(row) + "\n")
            logf.flush()
            tag = {"ok": "ok", "skipped_resume": "skip", "error": "err", "uploaded_partial": "partial"}.get(
                row["status"], "?"
            )
            print(f"  [{i:>4}/{len(filers)}] {tag} {fid}", flush=True)

    with log_path.open("w") as logf:
        if workers <= 1:
            for i, fid in enumerate(filers, start=1):
                dispatch(i, fid, logf)
        else:
            with ThreadPoolExecutor(max_workers=workers) as ex:
                futs = [ex.submit(dispatch, i, fid, logf) for i, fid in enumerate(filers, start=1)]
                for _ in as_completed(futs):
                    pass

    batch_upload: dict | None = None
    if upload_mode == "batch":
        print("\n=== batch upload (gcloud storage rsync) ===")
        ok, msg = _rsync_out_dir_to_gcs(args.out_dir, args.gcs_bucket)
        batch_upload = {"ok": ok, "output_tail": msg[-2000:] if msg else ""}
        print(batch_upload["output_tail"])

    duration = round(time.perf_counter() - t_start, 1)
    summary_path.write_text(
        json.dumps(
            {
                "started_at_utc": datetime.now(timezone.utc).isoformat(),
                "duration_s": duration,
                "count_total": len(filers),
                "counts": counts,
                "out_dir": str(args.out_dir),
                "filer_root": str(root),
                "upload_mode": upload_mode,
                "workers": workers,
                "batch_upload": batch_upload,
                "log_file": str(log_path),
            },
            indent=2,
        ),
    )

    print("\n=== Summary ===")
    print(f"  duration : {duration}s")
    for k, v in counts.items():
        print(f"  {k:<18}: {v}")
    exit_ok = counts.get("error", 0) == 0 and (
        batch_upload is None or batch_upload.get("ok")
    )
    return 0 if exit_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
