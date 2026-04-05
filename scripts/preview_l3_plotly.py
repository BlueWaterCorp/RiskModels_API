#!/usr/bin/env python3
"""
Preview L3 horizontal charts in a browser (HTML) or PNG (Kaleido).

Delegates to the SDK gallery/plot modules so title, subtitle, and styling defaults
stay in one place.  Adds HTML-preview + ``webbrowser.open`` on top.

Loads ``.env.local`` from repo root + ``sdk/`` (same as ``run_visuals_gallery.py``).

Examples (from repo root)::

    # MAG7 explained risk (variance 0–100%; not σ-scaled) → figures/l3_preview_er.html
    python scripts/preview_l3_plotly.py --mode er

    # MAG7 σ-scaled RR+HR → figures/l3_preview_sigma.html (avoid reusing er tab / cache)
    python scripts/preview_l3_plotly.py --mode sigma --theme terminal_dark

    # Single name NVDA, σ-scaled
    python scripts/preview_l3_plotly.py --mode nvda

    # Write PNG instead (needs kaleido)
    python scripts/preview_l3_plotly.py --mode er --png -o figures/l3_preview.png

Requires ``RISKMODELS_API_KEY`` and network. Plotly only for ``--html``; add ``pip install kaleido`` for ``--png``.
"""
from __future__ import annotations

import argparse
import sys
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SDK_SRC = ROOT / "sdk"
if SDK_SRC.is_dir() and str(SDK_SRC) not in sys.path:
    sys.path.insert(0, str(SDK_SRC))

from riskmodels.env import load_repo_dotenv

load_repo_dotenv(ROOT)
load_repo_dotenv(ROOT / "sdk")


def main() -> int:
    p = argparse.ArgumentParser(description="Preview Plotly L3 charts (browser HTML or PNG).")
    p.add_argument(
        "--mode",
        choices=("er", "sigma", "nvda"),
        default="er",
        help="er = MAG7 variance shares; sigma = MAG7 σ-scaled RR+HR; nvda = single-name σ-scaled",
    )
    p.add_argument("--theme", choices=("light", "terminal_dark"), default="light")
    p.add_argument("--png", action="store_true", help="Write PNG via Kaleido (default: HTML)")
    p.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Output path (default: figures/l3_preview_{er|sigma|nvda}[_{theme}].html or .png)",
    )
    args = p.parse_args()

    from riskmodels import RiskModelsClient
    from riskmodels.visuals.mag7_l3_er import (
        MAG7_L3_ER_DEFAULT_TICKERS,
        plot_mag7_l3_explained_risk,
    )
    from riskmodels.visuals.mag7_l3_sigma_rr import (
        MAG7_L3_SIGMA_RR_DEFAULT_TICKERS,
        plot_mag7_l3_sigma_rr,
    )
    from riskmodels.performance.stock import StockCurrent
    from riskmodels.visuals.l3_decomposition import plot_l3_horizontal
    from riskmodels.visuals.save import write_plotly_png

    # Disambiguate output filenames by mode + theme to avoid cached browser tabs.
    theme_suffix = f"_{args.theme}" if args.theme != "light" else ""
    out = args.output
    if out is None:
        suffix = "png" if args.png else "html"
        out = ROOT / "figures" / f"l3_preview_{args.mode}{theme_suffix}.{suffix}"
    out = out.resolve()
    out.parent.mkdir(parents=True, exist_ok=True)

    client = RiskModelsClient.from_env()
    try:
        if args.mode == "er":
            fig = plot_mag7_l3_explained_risk(client)
        elif args.mode == "sigma":
            fig = plot_mag7_l3_sigma_rr(client, theme=args.theme)
        else:
            # Single name NVDA — no dedicated gallery module, use low-level path.
            sc = StockCurrent(client)
            rows, lineage = sc._metric_rows_for_tickers(["NVDA"], years=1)
            if not rows:
                print("No batch rows returned for NVDA.", file=sys.stderr)
                return 1
            fig = plot_l3_horizontal(
                rows,
                sigma_scaled=True,
                annotation_mode="rr_hr",
                lineage=lineage,
                theme=args.theme,
            )

        if args.png:
            write_plotly_png(fig, out, width=1600, height=1000, scale=2)
        else:
            fig.write_html(str(out), include_plotlyjs="cdn", full_html=True)

        sigma_scaled = args.mode in ("sigma", "nvda")
        kind = (
            "σ-scaled L3 RR+HR (x = annualized vol; bar length ∝ σ)"
            if sigma_scaled
            else "variance shares (not σ-scaled; bars sum to 100% of explained risk)"
        )
        print(f"{kind}\n{out.as_uri()}", flush=True)
        webbrowser.open(out.as_uri())
    finally:
        client.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
