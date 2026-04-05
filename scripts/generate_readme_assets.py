#!/usr/bin/env python3
"""
Generate static PNGs for the GitHub README and portal docs using live RiskModels API data.

Every numeric cell in the charts comes from API responses (correlation + rankings). There is no
random or placeholder data. The only static fallback is the MAG7 ticker list if
``search_tickers(mag7=True)`` returns no rows. If ``POST /correlation`` returns only null
correlations (e.g. empty ``macro_factors``), macro heatmap and ``readme_inspiration.png`` are
skipped and the script still writes rankings + MAG7 Plotly assets when possible.

Requires ``RISKMODELS_API_KEY`` (free tier is enough: MAG7 + rankings + correlation).

Outputs:
  - ``assets/`` — paths referenced by ``README.md`` (GitHub)
  - ``public/docs/readme/`` — same files for the Next.js site (``/docs/readme/...``)
  - ``mag7_l3_sigma_rr.png`` — Plotly **MAG7 L3 σ-scaled** horizontal bars (annualized vol × L3 RR + HR
    residual share). Requires ``kaleido`` (``pip install riskmodels-py[viz]``).
  - ``mag7_risk_cascade.png`` — Plotly **portfolio risk cascade** (MAG7 weights ∝ ``market_cap`` from
    ``get_metrics``), for ``sdk/README.md``. Requires ``kaleido`` (``pip install riskmodels-py[viz]``).

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

# Repo root (e.g. RiskModels_API/.env.local) and sdk/ (editable install habit) — both merge; shell env wins.
load_repo_dotenv(ROOT)
load_repo_dotenv(ROOT / "sdk")

from riskmodels.visuals._mag7 import (
    mag7_cap_weighted_positions as _mag7_cap_weighted_positions_full,
    mag7_tickers as _mag7_tickers,
    normalize_tickers as _normalize_tickers,
)

MACRO_KEYS = ("vix", "gold", "bitcoin")
MACRO_LABELS = {"macro_corr_vix": "VIX", "macro_corr_gold": "Gold", "macro_corr_bitcoin": "BTC"}


def _mag7_cap_weighted_positions(client) -> list[dict[str, Any]]:
    """MAG7 list with weights proportional to latest ``market_cap`` from ``get_metrics`` (same as sdk README)."""
    positions, _src = _mag7_cap_weighted_positions_full(client)
    return positions


def _write_mag7_l3_sigma_rr_png(client, path: Path) -> None:
    """MAG7 L3 σ-scaled RR + HR (``save_mag7_l3_sigma_rr_png``); Kaleido static export."""
    from riskmodels.visuals.mag7_l3_sigma_rr import save_mag7_l3_sigma_rr_png

    save_mag7_l3_sigma_rr_png(
        client,
        filename=path,
        width=1600,
        height=1000,
        scale=3,
        theme="light",
    )


def _write_mag7_risk_cascade_png(client, path: Path) -> None:
    """Plotly static PNG via Kaleido (``pip install kaleido``)."""
    from riskmodels.visuals.save import write_plotly_png

    positions = _mag7_cap_weighted_positions(client)
    if not positions:
        raise RuntimeError("No MAG7 positions for risk cascade.")
    fig = client.portfolio.current.plot(
        positions=positions,
        style="risk_cascade",
        sort_by="weight",
        include_systematic_labels=True,
    )
    write_plotly_png(fig, path, width=960, height=540, scale=2)


def _corr_matrix_has_finite(matrix) -> bool:
    """True if at least one correlation cell is a finite float (not all null / NaN)."""
    import numpy as np
    import pandas as pd

    m = matrix.apply(pd.to_numeric, errors="coerce")
    arr = m.to_numpy(dtype=float, copy=False)
    return bool(np.isfinite(arr).any())


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
    parser.add_argument(
        "--no-sdk-cascade",
        action="store_true",
        help="Skip MAG7 cap-weighted portfolio risk cascade PNG (sdk/README.md asset).",
    )
    parser.add_argument(
        "--no-mag7-l3-sigma",
        action="store_true",
        help="Skip MAG7 L3 σ-scaled RR+HR PNG (README asset mag7_l3_sigma_rr.png).",
    )
    parser.add_argument(
        "--only-sdk-cascade",
        action="store_true",
        help="Only write mag7_risk_cascade.png (MAG7 cap weights + portfolio risk cascade); skip correlation/rankings.",
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

    if args.only_sdk_cascade:
        args.out_dir.mkdir(parents=True, exist_ok=True)
        args.public_dir.mkdir(parents=True, exist_ok=True)
        cascade_only = args.out_dir / "mag7_risk_cascade.png"
        try:
            _write_mag7_risk_cascade_png(client, cascade_only)
        except Exception as e:
            print(f"MAG7 risk cascade failed: {e}", file=sys.stderr)
            return 4
        dest = args.public_dir / cascade_only.name
        dest.write_bytes(cascade_only.read_bytes())
        print("Wrote", cascade_only, "(mirrored to", args.public_dir, ")", file=sys.stderr)
        return 0

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

    # All-null correlations (e.g. sparse L3 residual overlap vs macro) — try gross before plotting.
    if (
        not _corr_matrix_has_finite(matrix)
        and args.return_type == "l3_residual"
        and not args.no_fallback_gross
    ):
        print(
            "Macro correlation matrix has no finite values (all null). "
            "Retrying with return_type=gross …",
            file=sys.stderr,
        )
        try:
            matrix, rt_label = (
                _correlation_matrix(client, mag7, mode=args.correlation_mode, return_type="gross"),
                "gross",
            )
        except Exception as e:
            print(f"Gross correlation retry failed: {e}", file=sys.stderr)
            return 3
        print(f"Note: macro heatmaps use return_type={rt_label} (fallback from all-null l3_residual).", file=sys.stderr)

    matrix_ok = _corr_matrix_has_finite(matrix)
    if not matrix_ok:
        print(
            "Macro correlation matrix has no finite correlations after coercion (macro_factors may be "
            "empty for this window, or all overlap checks failed). "
            "Skipping macro_heatmap.png and readme_inspiration.png; continuing with rankings + MAG7 assets.",
            file=sys.stderr,
        )

    args.out_dir.mkdir(parents=True, exist_ok=True)
    args.public_dir.mkdir(parents=True, exist_ok=True)

    readme_dpi = 300
    macro_path: Path | None = None
    if matrix_ok:
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

    hero_path: Path | None = None
    if matrix_ok:
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

    sigma_rr_path: Path | None = None
    if not args.no_mag7_l3_sigma:
        sigma_rr_path = args.out_dir / "mag7_l3_sigma_rr.png"
        try:
            _write_mag7_l3_sigma_rr_png(client, sigma_rr_path)
            print("Wrote", sigma_rr_path, file=sys.stderr)
        except Exception as e:
            print(
                f"MAG7 L3 σ-scaled PNG not written (install kaleido + riskmodels-py[viz]): {e}",
                file=sys.stderr,
            )
            sigma_rr_path = None

    cascade_path: Path | None = None
    if not args.no_sdk_cascade:
        cascade_path = args.out_dir / "mag7_risk_cascade.png"
        try:
            _write_mag7_risk_cascade_png(client, cascade_path)
            print("Wrote", cascade_path, file=sys.stderr)
        except Exception as e:
            print(f"MAG7 risk cascade PNG not written (install kaleido + riskmodels-py[viz]): {e}", file=sys.stderr)
            cascade_path = None

    extra = tuple(p for p in (sigma_rr_path, cascade_path) if p is not None)
    for src in (macro_path, bar_path, needle_path, hero_path, *extra):
        if src is None:
            continue
        dest = args.public_dir / src.name
        dest.write_bytes(src.read_bytes())

    base_display = (
        os.environ.get("RISKMODELS_BASE_URL", "https://riskmodels.app/api").rstrip("/")
    )
    factor_cols = ", ".join(str(c) for c in matrix.columns) if matrix_ok else "(skipped)"
    wrote: list[Path] = []
    if macro_path is not None:
        wrote.append(macro_path)
    wrote.extend([bar_path, needle_path])
    if hero_path is not None:
        wrote.append(hero_path)
    if sigma_rr_path is not None:
        wrote.append(sigma_rr_path)
    if cascade_path is not None:
        wrote.append(cascade_path)
    print(
        "Wrote",
        *wrote,
        f"(mirrored to {args.public_dir})",
    )
    macro_blurb = (
        f"  Macro heatmap + hero left: Pearson macro_corr_* for [{factor_cols}] — "
        f"{rt_label}, 252d (POST /correlation).\n"
        if matrix_ok
        else "  Macro heatmap + hero: skipped (no finite correlations — check macro_factors / window).\n"
    )
    hero_right_blurb = (
        f"  Needle + hero right: rank_percentile from the {args.cohort} cohort row "
        f"(same API response as the bars, filtered in-script).\n"
        if hero_path is not None
        else "  Needle: rank_percentile from cohort row; readme hero skipped (no macro matrix).\n"
    )
    print(
        "\n--- README assets: live API data (no synthetic series) ---\n"
        f"  Base URL: {base_display}\n"
        f"  MAG7 tickers ({len(mag7)}): {', '.join(mag7)}\n"
        f"{macro_blurb}"
        f"  Rankings charts: GET /rankings/{ranking_ticker} — metric={args.metric}, "
        f"window={args.window} (all cohort rows returned by the API).\n"
        f"{hero_right_blurb}"
        + (
            "  MAG7 L3 σ-scaled: POST /batch/analyze (full_metrics + hedge_ratios + returns) → "
            "save_mag7_l3_sigma_rr_png.\n"
            if sigma_rr_path is not None
            else ""
        )
        + "---\n",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
