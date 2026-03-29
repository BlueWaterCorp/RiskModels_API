#!/usr/bin/env python3
"""
Generate static PNGs for the GitHub README and portal docs using live RiskModels API data.

Requires ``RISKMODELS_API_KEY`` (free tier is enough: MAG7 + rankings + correlation).

Outputs:
  - ``assets/`` — paths referenced by ``README.md`` (GitHub)
  - ``public/docs/readme/`` — same files for the Next.js site (``/docs/readme/...``)

Run from repo root. You can set ``RISKMODELS_API_KEY`` (and optional ``RISKMODELS_BASE_URL``)
in ``.env.local`` — the script loads it via ``python-dotenv`` (install SDK with ``[dev]``).

``echo RISKMODELS_BASE_URL=...`` **does not** set the variable (it only prints). Use ``export`` or
``.env.local``. Local API example::

    export RISKMODELS_BASE_URL=http://localhost:3000/api   # npm run dev
    export RISKMODELS_API_KEY='rm_agent_...'
    python scripts/generate_readme_assets.py

Optional: ``.github/workflows/readme-assets.yml`` (set repo secret ``RISKMODELS_API_KEY``).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import warnings
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SDK_SRC = ROOT / "sdk"
if SDK_SRC.is_dir() and str(SDK_SRC) not in sys.path:
    sys.path.insert(0, str(SDK_SRC))

from riskmodels.env import load_repo_dotenv

load_repo_dotenv(ROOT)

MACRO_KEYS = ("vix", "gold", "bitcoin")
MACRO_LABELS = {"macro_corr_vix": "VIX", "macro_corr_gold": "Gold", "macro_corr_bitcoin": "BTC"}
# Canonical share class for Alphabet (API resolves GOOGL→GOOG; use GOOG to avoid alias warnings).
MAG7_FALLBACK = ["AAPL", "MSFT", "GOOG", "AMZN", "META", "NVDA", "TSLA"]


def _normalize_tickers(tickers: list[str]) -> list[str]:
    out: list[str] = []
    for t in tickers:
        u = str(t).strip()
        if u.upper() == "GOOGL":
            u = "GOOG"
        out.append(u)
    return out


def _mag7_tickers(client) -> list[str]:
    df = client.search_tickers(mag7=True)
    if getattr(df, "empty", True):
        return list(MAG7_FALLBACK)
    col = "ticker" if "ticker" in df.columns else df.columns[0]
    out = [str(x).strip() for x in df[col].tolist() if x and str(x).strip()]
    return _normalize_tickers(out if out else list(MAG7_FALLBACK))


def _df_to_corr_matrix(df) -> object:
    if df.empty:
        raise RuntimeError("Correlation response returned no rows.")
    if "macro_batch_error" in df.columns:
        df = df[df["macro_batch_error"].isna()].copy()
    if df.empty:
        raise RuntimeError("All correlation rows failed (macro_batch_error).")
    cols_present = [c for c in MACRO_LABELS if c in df.columns]
    if len(cols_present) < 2:
        raise RuntimeError(f"Expected macro_corr_* columns; got: {list(df.columns)}")
    tcol = "ticker" if "ticker" in df.columns else None
    if not tcol:
        raise RuntimeError("Correlation frame missing ticker column.")
    sub = df[[tcol] + cols_present].set_index(tcol)
    sub = sub.rename(columns={k: MACRO_LABELS[k] for k in cols_present})
    return sub.sort_index()


def _correlation_matrix_batch(client, tickers: list[str], *, return_type: str):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        df = client.get_factor_correlation(
            tickers,
            factors=list(MACRO_KEYS),
            return_type=return_type,
            window_days=252,
            method="pearson",
            as_dataframe=True,
        )
    return _df_to_corr_matrix(df)


def _correlation_matrix_sequential(client, tickers: list[str], *, return_type: str):
    """One GET /metrics/{ticker}/correlation per symbol (same math as batch; different billable request count)."""
    import pandas as pd

    rows: list[dict] = []
    for t in tickers:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            one = client.get_factor_correlation_single(
                t,
                factors=list(MACRO_KEYS),
                return_type=return_type,
                window_days=252,
                method="pearson",
                as_dataframe=True,
            )
        rows.append(one.iloc[0].to_dict())
    return _df_to_corr_matrix(pd.DataFrame(rows))


def _print_api_error(exc: BaseException) -> None:
    from riskmodels.exceptions import APIError

    if not isinstance(exc, APIError):
        print(f"Error: {exc}", file=sys.stderr)
        return
    print(f"HTTP {exc.status_code}: {exc}", file=sys.stderr)
    if exc.body is not None:
        try:
            print(json.dumps(exc.body, indent=2) if isinstance(exc.body, dict) else exc.body, file=sys.stderr)
        except Exception:
            print(repr(exc.body), file=sys.stderr)
    if exc.status_code == 402:
        print(
            "\nBatch POST /correlation bills per ticker in the array (~7× the single-ticker unit). "
            "Ensure balance covers that, or set --correlation-mode sequential (7 separate requests; "
            "total $ similar but can behave differently with free-tier daily limits).",
            file=sys.stderr,
        )
    if exc.status_code == 429:
        print(
            "\nFree-tier daily query limit may apply. Retry tomorrow or use a paid key with balance.",
            file=sys.stderr,
        )
    if exc.status_code == 403:
        print(
            "\nKey may be missing the factor-correlation scope. Check Account → API key scopes.",
            file=sys.stderr,
        )
    if exc.status_code == 401:
        print(
            "\n401: Auth failed. Common fixes:\n"
            "  • Export only the key value:  export RISKMODELS_API_KEY='rm_agent_...'\n"
            "    (do not nest RISKMODELS_API_KEY= inside the value or paste from a KEY=value line twice.)\n"
            "  • Local Next (localhost): ensure the same key works against your dev DB, or unset\n"
            "    RISKMODELS_BASE_URL to call https://riskmodels.app/api with your key.",
            file=sys.stderr,
        )
    if exc.status_code == 500:
        print(
            "\nServer error on correlation. With the default script, l3_residual is retried as gross "
            "automatically; use --no-fallback-gross to disable. Or deploy the latest API (correlation routes "
            "return JSON error bodies on failure).",
            file=sys.stderr,
        )


def _correlation_matrix(client, tickers: list[str], *, mode: str, return_type: str) -> object:
    from riskmodels.exceptions import APIError

    tickers = _normalize_tickers(tickers)
    if mode == "sequential":
        return _correlation_matrix_sequential(client, tickers, return_type=return_type)
    if mode == "batch":
        return _correlation_matrix_batch(client, tickers, return_type=return_type)
    # auto: try batch, then sequential
    try:
        return _correlation_matrix_batch(client, tickers, return_type=return_type)
    except APIError as e:
        print("POST /correlation failed; retrying with sequential GET /metrics/{ticker}/correlation …", file=sys.stderr)
        _print_api_error(e)
        return _correlation_matrix_sequential(client, tickers, return_type=return_type)


def _warn_if_malformed_api_key() -> None:
    """Detect common copy-paste mistakes (nested KEY=value in the secret)."""
    k = os.environ.get("RISKMODELS_API_KEY", "").strip()
    if not k:
        return
    if "RISKMODELS_API_KEY" in k or k.startswith("export "):
        print(
            "Warning: RISKMODELS_API_KEY should be only the token (e.g. rm_agent_...), not a full KEY=value line.",
            "Example:  export RISKMODELS_API_KEY='rm_agent_...'",
            file=sys.stderr,
        )


def _correlation_matrix_with_gross_fallback(
    client,
    tickers: list[str],
    *,
    mode: str,
    return_type: str,
    fallback_gross: bool,
) -> tuple[object, str]:
    """Return ``(matrix, effective_return_type)``. On server 5xx with ``l3_residual``, retry as ``gross``."""
    from riskmodels.exceptions import APIError

    try:
        return (
            _correlation_matrix(client, tickers, mode=mode, return_type=return_type),
            return_type,
        )
    except APIError as e:
        if (
            fallback_gross
            and return_type == "l3_residual"
            and e.status_code is not None
            and 500 <= e.status_code < 504
        ):
            print(
                f"Correlation failed with HTTP {e.status_code} for return_type=l3_residual; "
                "retrying with return_type=gross …",
                file=sys.stderr,
            )
            _print_api_error(e)
            return (
                _correlation_matrix(client, tickers, mode=mode, return_type="gross"),
                "gross",
            )
        raise


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Write README/doc PNGs from live API (MAG7 + rankings).",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=ROOT / "assets",
        help="Primary output (GitHub README paths)",
    )
    parser.add_argument(
        "--public-dir",
        type=Path,
        default=ROOT / "public" / "docs" / "readme",
        help="Mirror for Next.js static files (/docs/readme/…)",
    )
    parser.add_argument(
        "--ranking-ticker",
        default=None,
        help="Ticker for get_rankings / needle (default: first MAG7 symbol)",
    )
    parser.add_argument("--metric", default="subsector_residual")
    parser.add_argument("--window", default="252d")
    parser.add_argument("--cohort", default="subsector")
    parser.add_argument(
        "--correlation-mode",
        choices=("auto", "batch", "sequential"),
        default="auto",
        help="How to fetch macro correlations: POST /correlation batch, per-ticker GET, or batch then fallback.",
    )
    parser.add_argument(
        "--return-type",
        dest="return_type",
        choices=("l3_residual", "gross", "l1", "l2"),
        default="l3_residual",
        help="Stock return series for macro correlation (default l3_residual). Use gross if the API errors on L3.",
    )
    parser.add_argument(
        "--no-fallback-gross",
        action="store_true",
        help="Do not automatically retry as gross when l3_residual returns HTTP 5xx.",
    )
    args = parser.parse_args()

    if not os.environ.get("RISKMODELS_API_KEY"):
        print("RISKMODELS_API_KEY is required (free-tier key works).", file=sys.stderr)
        return 1

    _warn_if_malformed_api_key()

    from riskmodels.client import RiskModelsClient
    from riskmodels.visual_refinement import (
        save_macro_sensitivity_matrix,
        save_ranking_chart,
        save_ranking_percentile_bar_chart,
        save_risk_intel_inspiration_figure,
    )

    client = RiskModelsClient.from_env()
    base_url_set = "RISKMODELS_BASE_URL" in os.environ
    print(
        "Using RISKMODELS_BASE_URL =",
        repr(os.environ.get("RISKMODELS_BASE_URL", "https://riskmodels.app/api (default via SDK)")),
        file=sys.stderr,
    )
    if not base_url_set:
        print(
            "Tip: for localhost, `export RISKMODELS_BASE_URL=http://localhost:3000/api` "
            "(or add it to .env.local). `echo VAR=...` does not set the environment.",
            file=sys.stderr,
        )
    mag7 = _mag7_tickers(client)
    ranking_ticker = args.ranking_ticker or mag7[0]

    try:
        matrix, rt_label = _correlation_matrix_with_gross_fallback(
            client,
            mag7,
            mode=args.correlation_mode,
            return_type=args.return_type,
            fallback_gross=not args.no_fallback_gross,
        )
    except Exception as e:
        from riskmodels.exceptions import APIError

        if isinstance(e, APIError):
            _print_api_error(e)
        else:
            print(f"Correlation fetch failed: {e}", file=sys.stderr)
        return 3

    if rt_label != args.return_type:
        print(
            f"Note: macro heatmaps use return_type={rt_label} (automatic fallback from l3_residual).",
            file=sys.stderr,
        )

    args.out_dir.mkdir(parents=True, exist_ok=True)
    args.public_dir.mkdir(parents=True, exist_ok=True)

    readme_dpi = 300
    macro_path = args.out_dir / "macro_heatmap.png"
    save_macro_sensitivity_matrix(
        matrix,
        str(macro_path),
        title=f"MAG7 — macro correlations ({rt_label}, 252d)",
        dpi=readme_dpi,
        style="readme_dark",
    )

    # Fetch ALL cohorts for the bar chart (universe, sector, subsector)
    rank_df = client.get_rankings(
        ranking_ticker,
        metric=args.metric,
        window=args.window,
        as_dataframe=True,
    )
    if rank_df.empty:
        print("get_rankings returned no rows; check ticker and filters.", file=sys.stderr)
        return 2

    bar_path = args.out_dir / "ranking_cohorts.png"
    save_ranking_percentile_bar_chart(
        rank_df,
        str(bar_path),
        metric=args.metric,
        window=args.window,
        ticker=ranking_ticker,
        readme_dark=True,
    )

    sub = rank_df
    if "metric" in sub.columns:
        sub = sub.loc[sub["metric"].astype(str) == args.metric]
    if "window" in sub.columns:
        sub = sub.loc[sub["window"].astype(str) == args.window]
    if "cohort" in sub.columns:
        sub_cohort = sub.loc[sub["cohort"].astype(str) == args.cohort]
        if not sub_cohort.empty:
            sub = sub_cohort
    if sub.empty:
        sub = rank_df
    row = sub.iloc[0]
    subtitle = f"{args.window} · {args.cohort} · {args.metric}"
    needle_path = args.out_dir / "ranking_snapshot.png"
    save_ranking_chart(
        ranking_ticker,
        row,
        str(needle_path),
        subtitle=subtitle,
        theme="readme_dark",
        transparent=False,
        dpi=readme_dpi,
    )

    hero_path = args.out_dir / "readme_inspiration.png"
    save_risk_intel_inspiration_figure(
        matrix,
        ranking_ticker,
        row,
        str(hero_path),
        macro_title=f"MAG7 — macro correlations ({rt_label}, 252d)",
        ranking_subtitle=subtitle,
        theme="readme_dark",
        dpi=readme_dpi,
    )

    for src in (macro_path, bar_path, needle_path, hero_path):
        dest = args.public_dir / src.name
        dest.write_bytes(src.read_bytes())

    print(
        "Wrote",
        macro_path,
        bar_path,
        needle_path,
        hero_path,
        f"(mirrored to {args.public_dir})",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
