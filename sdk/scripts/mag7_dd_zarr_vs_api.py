#!/usr/bin/env python3
"""Build Stock Deep Dive (DD) snapshots from local ERM3 zarr (no API data fetch).

Optionally compares the zarr PNG to a **reference** production PNG (GCS or a local
file under ``sdk/riskmodels/snapshots/output/``).

**Important:** ``sha256_identical`` is often **false** vs production: zarr macro uses
ERM3 ``ds_macro_factor`` (Pearson vs L3 residual); API may differ slightly. Company
name and some copy can still differ. Use ``mean_abs_diff_rgb`` as a rough hint.

By default the script loads **peer scatter + DNA** via ``RiskModelsClient.from_env()``
(``RISKMODELS_API_KEY`` or OAuth client env vars). Pass ``--no-api-peers`` for fully
offline zarr-only renders.

Usage (from repo root)::
    PYTHONPATH=sdk python sdk/scripts/mag7_dd_zarr_vs_api.py
    PYTHONPATH=sdk python sdk/scripts/mag7_dd_zarr_vs_api.py --reference local
    PYTHONPATH=sdk python sdk/scripts/mag7_dd_zarr_vs_api.py --no-api-peers

Requires:
  - ``xarray``, ``zarr``, ``numpy``, ``pandas``, ``pillow``
  - Snapshot extras: ``plotly``, ``kaleido``, ``matplotlib``, ``qrcode[pil]``
  - RiskModels API credentials in env for default peer loading (optional if ``--no-api-peers``)
  - ERM3 checkout for ``erm3.shared.etf_register.FS_INDUSTRY_TO_SUBSECTOR_ETFS``

Default zarr root: sibling ``../ERM3/data/stock_data/zarr/eodhd`` from this repo, or set ``ERM3_ZARR_ROOT``.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import subprocess
import sys
from pathlib import Path

# -----------------------------------------------------------------------------
# Paths
# -----------------------------------------------------------------------------
_REPO_ROOT = Path(__file__).resolve().parents[2]
_SDK_ROOT = Path(__file__).resolve().parents[1]


def _default_zarr_root() -> Path:
    if os.environ.get("ERM3_ZARR_ROOT"):
        return Path(os.environ["ERM3_ZARR_ROOT"])
    erm3 = Path(os.environ["ERM3_ROOT"]) if os.environ.get("ERM3_ROOT") else _REPO_ROOT.parent / "ERM3"
    return erm3 / "data" / "stock_data" / "zarr" / "eodhd"


_DEFAULT_ZARR = _default_zarr_root()

MAG7 = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOG", "META", "TSLA"]


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _png_mean_abs_diff(a: Path, b: Path) -> float | None:
    try:
        from PIL import Image
        from PIL import ImageChops
    except ImportError:
        return None
    im1 = Image.open(a).convert("RGB")
    im2 = Image.open(b).convert("RGB")
    if im1.size != im2.size:
        im2 = im2.resize(im1.size)
    diff = ImageChops.difference(im1, im2)
    import numpy as np
    arr = np.asarray(diff, dtype=np.float64)
    return float(arr.mean())


def main() -> int:
    ap = argparse.ArgumentParser(description="MAG7 DD from zarr vs GCS API snapshots")
    ap.add_argument("--zarr-root", type=Path, default=_DEFAULT_ZARR)
    ap.add_argument("--out-dir", type=Path, default=_SDK_ROOT / "riskmodels" / "snapshots" / "output" / "zarr_compare")
    ap.add_argument("--gcs-bucket", default="gs://rm_api_public/snapshot")
    ap.add_argument("--tickers", nargs="*", default=MAG7)
    ap.add_argument(
        "--reference",
        choices=("gcs", "local"),
        default="gcs",
        help=(
            "Where to load the reference PNG: GCS (rm_api_public) or "
            "sdk/riskmodels/snapshots/output/{TICKER}_DD_latest.png (must exist)."
        ),
    )
    ap.add_argument(
        "--no-api-peers",
        action="store_true",
        help="Do not call the API for PeerGroupProxy (offline; scatter/DNA are target-only).",
    )
    args = ap.parse_args()

    sys.path.insert(0, str(_SDK_ROOT))

    from riskmodels import RiskModelsClient
    from riskmodels.peer_group import PeerGroupProxy
    from riskmodels.snapshots.stock_deep_dive import DDData, render_dd_to_png
    from riskmodels.snapshots.zarr_context import build_p1_from_zarr

    out_dir = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    tmp_gcs = out_dir / "_gcs_dl"
    tmp_gcs.mkdir(exist_ok=True)

    api_client: RiskModelsClient | None = None
    if not args.no_api_peers:
        try:
            api_client = RiskModelsClient.from_env()
        except Exception as exc:
            print(
                f"WARN: could not create RiskModelsClient ({exc}); "
                "rendering without API peers. Fix env or pass --no-api-peers."
            )

    report_rows: list[dict] = []

    for t in args.tickers:
        t = t.upper()
        print(f"\n=== {t} zarr ===")
        p1 = build_p1_from_zarr(t, args.zarr_root)
        peer_comparison = None
        if api_client is not None:
            try:
                proxy = PeerGroupProxy.from_ticker(
                    api_client,
                    t,
                    group_by="subsector_etf",
                    weighting="market_cap",
                    sector_etf_override=p1.subsector_etf,
                    max_peers=15,
                )
                peer_comparison = proxy.compare(api_client)
            except Exception as exc:
                print(f"  (peers skipped for {t}: {exc})")

        dd = DDData(p1=p1, peer_comparison=peer_comparison)
        z_png = out_dir / f"{t}_DD_zarr.png"
        render_dd_to_png(dd, z_png)

        if args.reference == "gcs":
            gcs_png = f"{args.gcs_bucket}/{t}/{t}_DD_latest.png"
            local_ref = tmp_gcs / f"{t}_api_latest.png"
            try:
                subprocess.run(
                    ["gcloud", "storage", "cp", gcs_png, str(local_ref)],
                    check=True,
                    capture_output=True,
                    text=True,
                )
            except subprocess.CalledProcessError as e:
                print(f"  WARN: could not download {gcs_png}: {e.stderr}")
                report_rows.append(
                    {"ticker": t, "error": "gcs_download_failed", "detail": str(e.stderr)}
                )
                continue
            ref_label = gcs_png
        else:
            local_ref = _SDK_ROOT / "riskmodels" / "snapshots" / "output" / f"{t}_DD_latest.png"
            if not local_ref.is_file():
                print(f"  WARN: missing local reference {local_ref}")
                report_rows.append(
                    {
                        "ticker": t,
                        "error": "local_reference_missing",
                        "detail": str(local_ref),
                    }
                )
                continue
            ref_label = str(local_ref)

        mad = _png_mean_abs_diff(z_png, local_ref)
        z_s = _sha256_file(z_png)
        ref_s = _sha256_file(local_ref)
        identical = z_s == ref_s
        row = {
            "ticker": t,
            "reference": ref_label,
            "sha256_zarr_png": z_s,
            "sha256_reference_png": ref_s,
            "sha256_identical": identical,
            "mean_abs_diff_rgb": mad,
        }
        report_rows.append(row)
        print(json.dumps(row, indent=2))

    report = {
        "meta": {
            "reference_mode": args.reference,
            "api_peers": not args.no_api_peers,
            "api_client_available": api_client is not None,
            "sha256_identical_note": (
                "Often false vs production: zarr macro/company name/narrative vs API; "
                "default API peers align scatter/DNA."
            ),
        },
        "rows": report_rows,
    }
    rep_path = out_dir / "compare_report.json"
    rep_path.write_text(json.dumps(report, indent=2))
    print(f"\nWrote {rep_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
