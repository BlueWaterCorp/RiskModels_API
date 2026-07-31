"""Public stock data layer — P1Data dataclass + builders.

Extracted from the legacy ``p1_stock_performance`` module during the snapshot
canonicalization split (PR 3, 2026-05). The render layer for P1 lives in
BWMACRO; this module retains the data shapes that:

- The public canonical pipeline (:func:`riskmodels.snapshots.canonical.from_components`) consumes.
- The zarr ingestion path (:func:`riskmodels.snapshots.zarr_context.build_p1_from_zarr`) returns.
- External SDK callers reference for offline analysis or third-party renderers.

This module never imports from ``bwmacro.*``; the public bucket pipeline
(``rm_api_public`` GCS) must stay self-sufficient.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd

from ..exceptions import APIError
from ._data import (
    StockContext,
    cumulative_returns,
    cumulative_returns_from_column,
    fetch_stock_context,
    max_drawdown_series,
    rolling_sharpe,
    trailing_returns,
)


# ── Windowing + decomposition column names ────────────────────────────────

WINDOWS = {"1d": 1, "5d": 5, "1m": 21, "3m": 63, "6m": 126, "1y": 252}
WINDOW_LABELS = ["1d", "5d", "1m", "3m", "6m", "1y"]

# How many trailing daily rows a built P1Data stores. The 1Y default is what
# the reference renderer draws; a caller that serves trailing-window views of
# a cached P1Data passes a wider envelope so those views are a subset rather
# than a refetch.
ENVELOPE_ROWS_1Y: int = 252
ENVELOPE_ROWS_5Y: int = 1260

CFR_L1_COL = "l1_combined_factor_return"
CFR_L2_COL = "l2_combined_factor_return"
CFR_L3_COL = "l3_combined_factor_return"
CFR_COLUMNS = (CFR_L1_COL, CFR_L2_COL, CFR_L3_COL)


# ---------------------------------------------------------------------------
# Data contract
# ---------------------------------------------------------------------------

@dataclass
class P1Data:
    """All data needed to render a P1 (Stock Performance) snapshot.

    Produced by :func:`get_data_for_p1` (API path) or
    :func:`riskmodels.snapshots.zarr_context.build_p1_from_zarr` (zarr path).
    Consumed by canonical adapters (:func:`riskmodels.snapshots.canonical.from_components`)
    and by private renderers in BWMACRO.

    No API calls happen after this object is created.
    """

    ticker: str
    company_name: str
    teo: str
    universe: str
    sector_etf: str | None
    subsector_etf: str | None

    metrics: dict[str, Any]

    # Cumulative return series — lists of (date_str, cumulative_return)
    cum_stock: list[tuple[str, float]]
    cum_spy: list[tuple[str, float]]
    cum_sector: list[tuple[str, float]]
    cum_subsector: list[tuple[str, float]]

    # Trailing returns for each window — {window_label: value}
    tr_stock: dict[str, float | None]
    tr_spy: dict[str, float | None]
    tr_sector: dict[str, float | None]
    tr_subsector: dict[str, float | None]

    # Drawdown series — lists of (date_str, drawdown_value)
    dd_stock: list[tuple[str, float]]
    dd_spy: list[tuple[str, float]]

    # Point-in-time stats
    sharpe_1y: float | None
    max_drawdown: float | None   # worst peak-to-trough (negative decimal)
    vol_23d: float | None

    # Rankings — key: ranking_key ({window}_{cohort}_{metric}), value: {rank_percentile, cohort_size, ...}
    rankings: dict[str, Any] = field(default_factory=dict)

    # Macro factor correlations — key: factor name, value: correlation float
    macro_correlations: dict[str, float | None] = field(default_factory=dict)
    # Window string from fetch_macro_correlations_resilient (e.g. "252d", "63d gross")
    macro_window: str = "252d"

    # L3 ER time series — list of (date_str, mkt_er, sec_er, sub_er, res_er) daily values
    l3_er_series: list[tuple[str, float, float, float, float]] = field(default_factory=list)

    # True when cum_spy / cum_sector / cum_subsector use L1–L3 combined factor returns (CFR), not ETF gross
    cumulative_bench_lines_use_cfr: bool = False

    sdk_version: str = "0.3.0"

    # Human-readable classification (populated by build_p1_from_zarr from
    # bw_sector_code + subsector_etf lookup). Renderers fall back to the
    # ETF tickers when these are None for back-compat.
    sector_name: str | None = None
    subsector_name: str | None = None

    # PIT-gated fundamentals block (H.89.8) — populated by build_p1_from_zarr via
    # riskmodels.snapshots._fundamentals_zarr.build_fundamentals_pit(); a plain dict
    # (dataclasses.asdict of FundamentalsPIT) so it round-trips through to_json/from_json
    # with no _json_io.py changes. None when unavailable (older cached JSON, ticker not
    # in ds_fundamentals.zarr, etc.) — renderers must treat this as optional.
    fundamentals: dict[str, Any] | None = None

    @property
    def subsector_label(self) -> str:
        return self.subsector_etf or self.sector_etf or "—"

    # ── JSON serialization ───────────────────────────────────────────

    def to_json(self, path: str | Path) -> Path:
        from ._json_io import dump_json
        return dump_json(self, path)

    @classmethod
    def from_json(cls, path: str | Path) -> "P1Data":
        from ._json_io import load_json
        raw = load_json(path)
        d = raw["data"]

        def _load_series(lst: list | None) -> list[tuple[str, float]]:
            if not lst:
                return []
            return [(str(r[0]), float(r[1])) for r in lst if r[1] is not None]

        def _load_er_series(lst: list | None) -> list[tuple[str, float, float, float, float]]:
            if not lst:
                return []
            out = []
            for r in lst:
                if len(r) >= 5 and all(v is not None for v in r[1:5]):
                    out.append((str(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[4])))
            return out

        return cls(
            ticker=d["ticker"],
            company_name=d["company_name"],
            teo=d["teo"],
            universe=d["universe"],
            sector_etf=d.get("sector_etf"),
            subsector_etf=d.get("subsector_etf"),
            metrics=d.get("metrics", {}),
            cum_stock=_load_series(d.get("cum_stock")),
            cum_spy=_load_series(d.get("cum_spy")),
            cum_sector=_load_series(d.get("cum_sector")),
            cum_subsector=_load_series(d.get("cum_subsector")),
            tr_stock=d.get("tr_stock", {}),
            tr_spy=d.get("tr_spy", {}),
            tr_sector=d.get("tr_sector", {}),
            tr_subsector=d.get("tr_subsector", {}),
            dd_stock=_load_series(d.get("dd_stock")),
            dd_spy=_load_series(d.get("dd_spy")),
            sharpe_1y=d.get("sharpe_1y"),
            max_drawdown=d.get("max_drawdown"),
            vol_23d=d.get("vol_23d"),
            rankings=d.get("rankings", {}),
            macro_correlations=d.get("macro_correlations", {}),
            macro_window=d.get("macro_window", "252d"),
            l3_er_series=_load_er_series(d.get("l3_er_series")),
            cumulative_bench_lines_use_cfr=bool(d.get("cumulative_bench_lines_use_cfr", False)),
            sdk_version=d.get("sdk_version", "0.3.0"),
            fundamentals=d.get("fundamentals"),
        )


# ---------------------------------------------------------------------------
# Benchmark legend labels (used by canonical + private renderers)
# ---------------------------------------------------------------------------

def cumulative_benchmark_line_labels(data: "P1Data") -> tuple[str, str, str]:
    """Legend labels for the three benchmark lines in Section I (cumulative returns).

    CFR mode: each line is the cumulative L1/L2/L3 combined factor return.
    Gross fallback: independent ETF tracks ("SPY", sec, sub).
    """
    sec = data.sector_etf or "Sector"
    sub = data.subsector_etf or "Subsector"
    if data.cumulative_bench_lines_use_cfr:
        l1_lab = "L1 Factor(SPY)"
        l2_lab = f"L2 Cum Factor(SPY, {sec})"
        if sub and sub != sec:
            l3_lab = f"L3 Cum Factor(SPY, {sec}, {sub})"
        else:
            l3_lab = f"L3 Cum Factor(SPY, {sec})"
        return (l1_lab, l2_lab, l3_lab)
    return ("SPY", sec, sub)


# ---------------------------------------------------------------------------
# Macro correlations: l3_residual (252→63d) → gross fallback
# ---------------------------------------------------------------------------

def fetch_macro_correlations_resilient(
    client: Any,
    ticker: str,
) -> tuple[dict[str, float | None], str]:
    """Macro factor correlations: L3 residual (252→63d), then gross fallback."""
    last_warnings: list[str] = []

    for _wdays in (252, 126, 63):
        try:
            corr_resp = client.get_factor_correlation_single(
                ticker, return_type="l3_residual", window_days=_wdays,
            )
            _corrs = corr_resp.get("correlations", {})
            last_warnings = corr_resp.get("warnings", [])
            if any(v is not None for v in _corrs.values()):
                return _corrs, f"{_wdays}d"
        except APIError:
            continue

    for _wdays in (252, 126, 63):
        try:
            corr_resp = client.get_factor_correlation_single(
                ticker, return_type="gross", window_days=_wdays,
            )
            _corrs = corr_resp.get("correlations", {})
            last_warnings = corr_resp.get("warnings", [])
            if any(v is not None for v in _corrs.values()):
                return _corrs, f"{_wdays}d gross"
        except APIError:
            continue

    if last_warnings:
        import logging
        logger = logging.getLogger("riskmodels.snapshots")
        logger.warning(
            "Macro correlations failed for %s after all fallbacks. "
            "Last API warnings: %s",
            ticker,
            "; ".join(last_warnings),
        )

    return {}, "252d"


# ---------------------------------------------------------------------------
# Build P1Data
# ---------------------------------------------------------------------------

def _series_to_list(dates: pd.Index | pd.Series, values: pd.Series) -> list[tuple[str, float]]:
    """Convert aligned date + value series to a serializable list."""
    out = []
    for d, v in zip(dates, values):
        if pd.isna(v):
            continue
        out.append((str(d)[:10], float(v)))
    return out


def build_p1_data_from_stock_context(
    ctx: StockContext,
    client: Any | None = None,
    *,
    rankings: dict[str, Any] | None = None,
    macro_correlations: dict[str, Any] | None = None,
    macro_window: str | None = None,
    envelope_rows: int | None = None,
) -> "P1Data":
    """Assemble :class:`P1Data` from a :class:`StockContext`.

    Production path: :func:`fetch_stock_context` → this function with ``client`` set.
    Zarr path: :func:`riskmodels.snapshots.zarr_context.fetch_stock_context_zarr`
    → this function with ``client=None``, pre-filled ``rankings`` and macro.

    ``envelope_rows`` is how many trailing daily rows the built P1Data keeps
    (default :data:`ENVELOPE_ROWS_1Y`). A consumer that serves trailing-window
    views of this object without recomputing needs the object to hold the
    longest window it will ever be asked for; anything past the envelope is a
    live-compute request, not a display choice.
    """
    m = ctx.metrics
    vol_23d = m.get("vol_23d")

    rows = ENVELOPE_ROWS_1Y if envelope_rows is None else int(envelope_rows)

    def _tail(df: pd.DataFrame | None, days: int = rows) -> pd.DataFrame | None:
        if df is None or df.empty:
            return df
        return df.iloc[-days:].reset_index(drop=True)

    hist    = _tail(ctx.history)
    spy_df  = _tail(ctx.spy_returns)
    sec_df  = _tail(ctx.sector_returns)
    sub_df  = _tail(ctx.subsector_returns)

    def _cum(df: pd.DataFrame | None) -> list[tuple[str, float]]:
        if df is None or df.empty:
            return []
        cr = cumulative_returns(df)
        dates = df["date"] if "date" in df.columns else df.index
        return _series_to_list(dates, cr)

    cum_stock = _cum(hist)

    use_cfr = (
        hist is not None
        and not hist.empty
        and all(c in hist.columns for c in CFR_COLUMNS)
    )
    if use_cfr:
        nz = min(int(hist[c].notna().sum()) for c in CFR_COLUMNS)
        if nz < 5:
            use_cfr = False

    if use_cfr:
        def _cum_cfr(df: pd.DataFrame, col: str) -> list[tuple[str, float]]:
            cr = cumulative_returns_from_column(df, col)
            dates = df["date"] if "date" in df.columns else df.index
            return _series_to_list(dates, cr)

        cum_spy = _cum_cfr(hist, CFR_L1_COL)
        cum_sector = _cum_cfr(hist, CFR_L2_COL)
        cum_subsector = _cum_cfr(hist, CFR_L3_COL)
        cumulative_bench_lines_use_cfr = True
    else:
        cfr_present = (
            hist is not None
            and not hist.empty
            and all(c in hist.columns for c in CFR_COLUMNS)
        )
        reason = (
            "CFR columns sparse (<5 non-null daily rows)"
            if cfr_present
            else "CFR columns missing from /ticker-returns response"
        )
        warnings.warn(
            f"P1 cumulative-returns chart for {ctx.ticker} fell back to gross "
            f"ETF benchmarks: {reason}. Confirm security_history has daily rows "
            f"for metric_keys l1_cfr/l2_cfr/l3_cfr.",
            UserWarning,
            stacklevel=2,
        )
        cum_spy = _cum(spy_df)
        cum_sector = _cum(sec_df)
        cum_subsector = _cum(sub_df)
        cumulative_bench_lines_use_cfr = False

    tr_stock     = trailing_returns(ctx.history, WINDOWS)
    tr_spy       = trailing_returns(ctx.spy_returns, WINDOWS)
    tr_sector    = trailing_returns(ctx.sector_returns, WINDOWS)
    tr_subsector = trailing_returns(ctx.subsector_returns, WINDOWS)

    def _dd(df: pd.DataFrame | None) -> list[tuple[str, float]]:
        if df is None or df.empty:
            return []
        dd = max_drawdown_series(df)
        dates = df["date"] if "date" in df.columns else df.index
        return _series_to_list(dates, dd)

    dd_stock = _dd(hist)
    dd_spy   = _dd(spy_df)

    sharpe_1y: float | None = None
    if hist is not None and not hist.empty:
        sh = rolling_sharpe(hist, window=min(63, len(hist)))
        if not sh.empty and not pd.isna(sh.iloc[-1]):
            sharpe_1y = float(sh.iloc[-1])

    max_dd: float | None = None
    if dd_stock:
        max_dd = min(v for _, v in dd_stock)

    ticker = ctx.ticker

    rankings_out: dict[str, Any]
    if rankings is None:
        rankings_out = {}
        if client is not None:
            try:
                rdf = client.get_rankings(ticker)
                if not rdf.empty and "ranking_key" in rdf.columns:
                    for _, rrow in rdf.iterrows():
                        key = str(rrow["ranking_key"])
                        rankings_out[key] = {
                            "rank_ordinal":   rrow.get("rank_ordinal"),
                            "cohort_size":    rrow.get("cohort_size"),
                            "rank_percentile": rrow.get("rank_percentile"),
                            "metric":          rrow.get("metric"),
                            "cohort":          rrow.get("cohort"),
                            "window":          rrow.get("window"),
                        }
            except Exception as exc:
                warnings.warn(f"Could not fetch rankings for {ticker}: {exc}", UserWarning, stacklevel=2)
    else:
        rankings_out = rankings

    if macro_correlations is None:
        if client is not None:
            macro_out, macro_window_out = fetch_macro_correlations_resilient(client, ticker)
            if not any(v is not None for v in macro_out.values()):
                warnings.warn(
                    f"Macro correlations empty for {ticker} after l3_residual and gross fallbacks.",
                    UserWarning,
                    stacklevel=2,
                )
        else:
            macro_out, macro_window_out = {}, macro_window or "252d"
    else:
        macro_out = macro_correlations
        macro_window_out = macro_window if macro_window is not None else "252d"

    # Daily layer-return attribution series — see legacy p1 docs for derivation.
    l3_er_series: list[tuple[str, float, float, float, float]] = []
    if hist is not None and not hist.empty:
        ret_col = "returns_gross"
        cfr_cols_ok = (
            all(c in hist.columns for c in CFR_COLUMNS)
            and all(int(hist[c].notna().sum()) >= 5 for c in CFR_COLUMNS)
        )

        if cfr_cols_ok and ret_col in hist.columns:
            dates_col = hist["date"] if "date" in hist.columns else hist.index
            for d_val, ret_v, l1_v, l2_v, l3_v in zip(
                dates_col,
                hist[ret_col],
                hist[CFR_L1_COL], hist[CFR_L2_COL], hist[CFR_L3_COL],
            ):
                if any(pd.isna(v) for v in [ret_v, l1_v, l2_v, l3_v]):
                    continue
                l1_f = float(l1_v)
                l2_f = float(l2_v)
                l3_f = float(l3_v)
                g_f  = float(ret_v)
                mkt_inc = l1_f
                sec_inc = l2_f - l1_f
                sub_inc = l3_f - l2_f
                res_inc = g_f - l3_f
                l3_er_series.append((str(d_val)[:10], mkt_inc, sec_inc, sub_inc, res_inc))
        else:
            er_cols = ["l3_market_er", "l3_sector_er", "l3_subsector_er", "l3_residual_er"]
            if all(c in hist.columns for c in er_cols) and ret_col in hist.columns:
                warnings.warn(
                    f"P1 daily layer attribution for {ctx.ticker} is using legacy "
                    f"variance-share × gross slicing (l3_*_er × returns_gross) because "
                    f"CFR columns are missing or sparse. Re-sync security_history_returns_decomp "
                    f"to restore correct attribution.",
                    UserWarning,
                    stacklevel=2,
                )
                dates_col = hist["date"] if "date" in hist.columns else hist.index
                for d_val, ret_v, mkt_hr, sec_hr, sub_hr, res_hr in zip(
                    dates_col,
                    hist[ret_col],
                    hist["l3_market_er"], hist["l3_sector_er"],
                    hist["l3_subsector_er"], hist["l3_residual_er"],
                ):
                    if any(pd.isna(v) for v in [ret_v, mkt_hr, sec_hr, sub_hr, res_hr]):
                        continue
                    mkt_er = float(mkt_hr) * float(ret_v)
                    sec_er = float(sec_hr) * float(ret_v)
                    sub_er = float(sub_hr) * float(ret_v)
                    res_er = float(ret_v) - mkt_er - sec_er - sub_er
                    l3_er_series.append((str(d_val)[:10], mkt_er, sec_er, sub_er, res_er))

    return P1Data(
        ticker=ctx.ticker,
        company_name=ctx.company_name,
        teo=ctx.teo,
        universe=ctx.universe,
        sector_etf=ctx.sector_etf,
        subsector_etf=ctx.subsector_etf,
        metrics=m,
        cum_stock=cum_stock,
        cum_spy=cum_spy,
        cum_sector=cum_sector,
        cum_subsector=cum_subsector,
        tr_stock=tr_stock,
        tr_spy=tr_spy,
        tr_sector=tr_sector,
        tr_subsector=tr_subsector,
        dd_stock=dd_stock,
        dd_spy=dd_spy,
        sharpe_1y=sharpe_1y,
        max_drawdown=max_dd,
        vol_23d=float(vol_23d) if vol_23d is not None else None,
        rankings=rankings_out,
        macro_correlations=macro_out,
        macro_window=macro_window_out,
        l3_er_series=l3_er_series,
        cumulative_bench_lines_use_cfr=cumulative_bench_lines_use_cfr,
        sdk_version=ctx.sdk_version,
    )


def get_data_for_p1(
    ticker: str,
    client: Any,
    *,
    years: int = 2,
    as_of: str | None = None,
) -> "P1Data":
    """Fetch everything needed for the P1 data layer (API path)."""
    ctx = fetch_stock_context(
        ticker, client, years=years, include_spy=True, as_of=as_of,
    )
    return build_p1_data_from_stock_context(ctx, client)
