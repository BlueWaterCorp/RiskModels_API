#!/usr/bin/env python3
"""
Generate static PNGs for GitHub README / docs using the RiskModels SDK.

Requires RISKMODELS_API_KEY (and optional RISKMODELS_BASE_URL). Intended for manual runs or
`.github/workflows/readme-assets.yml`.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SDK_SRC = ROOT / "sdk"
if SDK_SRC.is_dir() and str(SDK_SRC) not in sys.path:
    sys.path.insert(0, str(SDK_SRC))


def main() -> int:
    parser = argparse.ArgumentParser(description="Write ranking PNGs under assets/readme/")
    parser.add_argument("--ticker", default="NVDA", help="Symbol for get_rankings")
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=ROOT / "assets",
        help="Output directory for PNG files (README uses ./assets/…)",
    )
    parser.add_argument(
        "--metric",
        default="subsector_residual",
        help="Metric row for needle chart (rank_percentile from this row)",
    )
    parser.add_argument("--window", default="252d")
    parser.add_argument("--cohort", default="subsector")
    args = parser.parse_args()

    if not os.environ.get("RISKMODELS_API_KEY"):
        print("RISKMODELS_API_KEY is not set; skipping SDK fetch.", file=sys.stderr)
        return 1

    from riskmodels.client import RiskModelsClient
    from riskmodels.visual_refinement import (
        save_ranking_chart,
        save_ranking_percentile_bar_chart,
    )

    args.out_dir.mkdir(parents=True, exist_ok=True)
    client = RiskModelsClient.from_env()
    df = client.get_rankings(
        args.ticker,
        metric=args.metric,
        cohort=args.cohort,
        window=args.window,
        as_dataframe=True,
    )
    if df.empty:
        print("get_rankings returned no rows; check ticker and filters.", file=sys.stderr)
        return 2

    bar_path = args.out_dir / "ranking_cohorts.png"
    save_ranking_percentile_bar_chart(
        df,
        str(bar_path),
        metric=args.metric,
        window=args.window,
        ticker=args.ticker,
        transparent=True,
    )

    sub = df
    if "metric" in sub.columns:
        sub = sub.loc[sub["metric"].astype(str) == args.metric]
    if "window" in sub.columns:
        sub = sub.loc[sub["window"].astype(str) == args.window]
    if sub.empty:
        sub = df
    row = sub.iloc[0]
    needle_path = args.out_dir / "ranking_snapshot.png"
    save_ranking_chart(
        args.ticker,
        row,
        str(needle_path),
        subtitle=f"{args.window} · {args.cohort} · {args.metric}",
        theme="transparent",
        transparent=True,
    )

    print(f"Wrote {bar_path}, {needle_path} (README: ./assets/ranking_snapshot.png)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
