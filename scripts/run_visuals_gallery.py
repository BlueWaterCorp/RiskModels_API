#!/usr/bin/env python3
"""
Generate the SDK **visuals gallery** PNGs (live API + Kaleido).

Writes, by default:

- ``nvda_l3_risk.png`` — single-name L3 decomposition (NVDA)
- ``mag7_l3_explained_risk.png`` — MAG7 L3 explained risk (variance fractions; article-style)
- ``mag7_l3_sigma_rr.png`` — MAG7 L3 σ-scaled RR + HR (annualized vol × risk ratios)
- ``mag7_risk_cascade.png`` — MAG7 cap-weighted L3 risk cascade
- ``mag7_attribution_cascade.png`` — MAG7 attribution proxy cascade

Requires ``RISKMODELS_API_KEY``, ``pip install riskmodels-py[viz]`` (Plotly + Kaleido), and network.

Run from the **repository root**::

    python scripts/run_visuals_gallery.py -o figures

``.env.local`` is loaded from the repo root and from ``sdk/`` (same pattern as
``scripts/generate_readme_assets.py``).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SDK_SRC = ROOT / "sdk"
if SDK_SRC.is_dir() and str(SDK_SRC) not in sys.path:
    sys.path.insert(0, str(SDK_SRC))

from riskmodels.env import load_repo_dotenv

load_repo_dotenv(ROOT)
load_repo_dotenv(ROOT / "sdk")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate SDK visuals gallery PNGs (run_gallery_* / run_gallery_all).",
    )
    parser.add_argument(
        "--output-dir",
        "-o",
        type=Path,
        default=Path("figures"),
        help="Output directory for PNG files (default: ./figures)",
    )
    parser.add_argument(
        "--charts",
        choices=("all", "nvda", "mag7-l3-er", "mag7-l3-sigma-rr", "mag7-risk", "mag7-attribution"),
        default="all",
        help="Which chart(s) to render (default: all).",
    )
    args = parser.parse_args()

    from riskmodels import RiskModelsClient
    from riskmodels.visuals import (
        run_gallery_all,
        run_gallery_mag7_attribution_cascade,
        run_gallery_mag7_l3_er,
        run_gallery_mag7_l3_sigma_rr,
        run_gallery_mag7_risk_cascade,
        run_gallery_nvda_l3,
    )

    out = args.output_dir.resolve()
    out.mkdir(parents=True, exist_ok=True)

    client = RiskModelsClient.from_env()
    paths: list[Path] = []
    try:
        if args.charts == "all":
            paths = run_gallery_all(client, output_dir=out)
        elif args.charts == "nvda":
            paths = [run_gallery_nvda_l3(client, output_dir=out)]
        elif args.charts == "mag7-l3-er":
            paths = [run_gallery_mag7_l3_er(client, output_dir=out)]
        elif args.charts == "mag7-l3-sigma-rr":
            paths = [run_gallery_mag7_l3_sigma_rr(client, output_dir=out)]
        elif args.charts == "mag7-risk":
            p, _src = run_gallery_mag7_risk_cascade(client, output_dir=out)
            paths = [p]
        else:
            p, _src = run_gallery_mag7_attribution_cascade(client, output_dir=out)
            paths = [p]
    finally:
        client.close()

    for path in paths:
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
