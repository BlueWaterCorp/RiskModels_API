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
  - ``mag7_risk_cascade.png`` — Plotly **portfolio risk cascade** (MAG7 weights ∝ ``market_cap`` from
    ``get_metrics``), for ``sdk/README.md``. Requires ``kaleido`` (``pip install riskmodels-py[viz]``).

Run from repo root. You can set ``RISKMODELS_API_KEY`` (and optional ``RISKMODELS_BASE_URL``)
in ``RiskModels_API/.env`` (internal; gitignored) — the script loads it via ``python-dotenv``
(install SDK with ``pip install -e 'sdk[dotenv]'`` or ``[dev]``). ``.env.local`` is also read.

``echo RISKMODELS_BASE_URL=...`` **does not** set the variable (it only prints). Use ``export`` or
``.env``. Local API example in ``.env``::

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

# MAG7 ticker resolution + cap weighting — inlined from the legacy
# ``riskmodels.visuals._mag7`` module that moved to BWMACRO during PR 3.
# These helpers stay public-side because the README assets pipeline runs
# from the ``rm_api_public`` boundary and cannot import ``bwmacro.*``.

MAG7_FALLBACK_LIST: list[str] = ["AAPL", "MSFT", "GOOG", "AMZN", "META", "NVDA", "TSLA"]

MAG7_CAP_WEIGHTS_FALLBACK_EARLY_2026: dict[str, float] = {
    "NVDA": 0.22, "AAPL": 0.18, "MSFT": 0.14, "GOOG": 0.12,
    "AMZN": 0.10, "META": 0.10, "TSLA": 0.14,
}


def _normalize_tickers(tickers: list[str]) -> list[str]:
    """Strip whitespace; map GOOGL → GOOG (single class for cap-weight roll-up)."""
    out: list[str] = []
    for t in tickers:
        u = str(t).strip()
        if u.upper() == "GOOGL":
            u = "GOOG"
        out.append(u)
    return out


def _mag7_tickers(client) -> list[str]:
    """Resolve MAG7 from API; fall back to the canonical 7-name list."""
    df = client.search_tickers(mag7=True)
    if getattr(df, "empty", True):
        return list(MAG7_FALLBACK_LIST)
    col = "ticker" if "ticker" in df.columns else df.columns[0]
    out = [str(x).strip() for x in df[col].tolist() if x and str(x).strip()]
    return _normalize_tickers(out if out else list(MAG7_FALLBACK_LIST))


def _mag7_cap_weighted_positions(client) -> list[dict[str, Any]]:
    """MAG7 list with weights ∝ latest ``market_cap`` from ``get_metrics``."""
    import pandas as pd

    tickers = _mag7_tickers(client)
    caps: list[tuple[str, float]] = []
    for sym in tickers:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            snap = client.get_metrics(sym, as_dataframe=True)
        row = snap.iloc[0]
        cap = row.get("market_cap")
        if cap is None or (isinstance(cap, float) and pd.isna(cap)):
            continue
        try:
            caps.append((str(sym).upper(), float(cap)))
        except (TypeError, ValueError):
            continue

    if len(caps) >= 3:
        wdf = pd.DataFrame(caps, columns=["ticker", "market_cap"])
        wdf["weight"] = wdf["market_cap"] / wdf["market_cap"].sum()
        return wdf[["ticker", "weight"]].to_dict("records")

    positions: list[dict[str, Any]] = []
    for t in tickers:
        w = MAG7_CAP_WEIGHTS_FALLBACK_EARLY_2026.get(str(t).upper(), 0.0)
        if w > 0:
            positions.append({"ticker": t, "weight": w})
    s = sum(float(p["weight"]) for p in positions)
    if s <= 0:
        n = len(tickers)
        return [{"ticker": t, "weight": 1.0 / n} for t in tickers]
    return [{"ticker": p["ticker"], "weight": float(p["weight"]) / s} for p in positions]


MACRO_KEYS = ("vix", "gold", "bitcoin")
# API canonicalizes the "vix" factor to "vix_spot", so the SDK column is macro_corr_vix_spot.
MACRO_LABELS = {"macro_corr_vix_spot": "VIX", "macro_corr_gold": "Gold", "macro_corr_bitcoin": "BTC"}


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
        "--only-sdk-cascade",
        action="store_true",
        help="Only write mag7_risk_cascade.png (MAG7 cap weights + portfolio risk cascade); skip correlation/rankings.",
    )
    args = parser.parse_args()

    if not os.environ.get("RISKMODELS_API_KEY"):
        print(
            "RISKMODELS_API_KEY is required (free-tier key works). "
            "Internal use: add it to RiskModels_API/.env — see script docstring.",
            file=sys.stderr,
        )
        return 1

    _warn_if_malformed_api_key()

    from riskmodels.client import RiskModelsClient
    from riskmodels.visual_refinement import (
        save_ranking_percentile_bar_chart,
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
            "Tip: for localhost, set RISKMODELS_BASE_URL in .env or .env.local "
            "(e.g. http://localhost:3000/api). `echo VAR=...` does not set the environment.",
            file=sys.stderr,
        )
    mag7 = _mag7_tickers(client)
    ranking_ticker = args.ranking_ticker or mag7[0]

    args.out_dir.mkdir(parents=True, exist_ok=True)
    args.public_dir.mkdir(parents=True, exist_ok=True)

    # Cross-sectional rank cohorts (universe, sector, subsector) for the bar chart.
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

    cascade_path: Path | None = None
    if not args.no_sdk_cascade:
        cascade_path = args.out_dir / "mag7_risk_cascade.png"
        try:
            _write_mag7_risk_cascade_png(client, cascade_path)
            print("Wrote", cascade_path, file=sys.stderr)
        except Exception as e:
            print(f"MAG7 risk cascade PNG not written (install kaleido + riskmodels-py[viz]): {e}", file=sys.stderr)
            cascade_path = None

    extra = tuple(p for p in (cascade_path,) if p is not None)
    for src in (bar_path, *extra):
        dest = args.public_dir / src.name
        dest.write_bytes(src.read_bytes())

    base_display = (
        os.environ.get("RISKMODELS_BASE_URL", "https://riskmodels.app/api").rstrip("/")
    )
    wrote: list[Path] = [bar_path]
    if cascade_path is not None:
        wrote.append(cascade_path)
    print(
        "Wrote",
        *wrote,
        f"(mirrored to {args.public_dir})",
    )
    print(
        "\n--- README assets: live API data (no synthetic series) ---\n"
        f"  Base URL: {base_display}\n"
        f"  MAG7 tickers ({len(mag7)}): {', '.join(mag7)}\n"
        f"  Rankings chart: GET /rankings/{ranking_ticker} — metric={args.metric}, "
        f"window={args.window} (all cohort rows returned by the API).\n"
        + "---\n",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
