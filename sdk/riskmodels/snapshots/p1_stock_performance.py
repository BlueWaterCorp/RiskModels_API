"""P1 Snapshot — Stock Return & Relative Performance (Current × Stock).

The first page of the Performance suite: how has this stock performed,
and how does it compare to its sector, subsector, and the market?

Layout (Letter Landscape, Pillow compositor)
--------------------------------------------
  Left panel : Company identity, performance stats, trailing returns table
  Top-right  : I. Cumulative Returns (stock vs L1–L3 CFR lines or ETF gross benchmarks)
  Mid-right  : II. Trailing Returns (grouped bar: stock vs benchmarks)
  Bot-right  : III. Drawdown (underwater equity curve, stock vs SPY)
  Footer     : Confidential + data TEO + SDK version

Usage
-----
    from riskmodels import RiskModelsClient
    from riskmodels.snapshots.p1_stock_performance import get_data_for_p1, render_p1_to_pdf

    client = RiskModelsClient()
    data   = get_data_for_p1("NVDA", client)
    data.to_json("nvda_p1.json")
    render_p1_to_pdf(data, "NVDA_P1_Perf.pdf")

    # Or offline:
    data = P1Data.from_json("nvda_p1.json")
    render_p1_to_pdf(data, "NVDA_P1_Perf.pdf")
"""

from __future__ import annotations

import datetime
import warnings
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd
import plotly.graph_objects as go

from ._plotly_theme import PLOTLY_THEME, apply_theme
from ._compose import (
    SnapshotComposer, NAVY, TEAL, TEXT_DARK, TEXT_MID, TEXT_LIGHT,
    WHITE, LIGHT_BG, BORDER,
)
from ._data import (
    StockContext,
    fetch_stock_context,
    trailing_returns,
    cumulative_returns,
    cumulative_returns_from_column,
    rolling_sharpe,
    max_drawdown_series,
    relative_returns,
    series_with_zero_start,
)
from ..exceptions import APIError
from ..visuals.smart_subheader import generate_subheader

T = PLOTLY_THEME

GREEN_RGB  = (0, 170, 0)
ORANGE_RGB = (224, 112, 0)
RED_RGB    = (200, 40, 40)

WINDOWS = {"1d": 1, "5d": 5, "1m": 21, "3m": 63, "6m": 126, "1y": 252}
WINDOW_LABELS = ["1d", "5d", "1m", "3m", "6m", "1y"]

# Returns-decomposition daily simple returns on /ticker-returns (semantic names after rename)
CFR_L1_COL = "l1_combined_factor_return"
CFR_L2_COL = "l2_combined_factor_return"
CFR_L3_COL = "l3_combined_factor_return"
CFR_COLUMNS = (CFR_L1_COL, CFR_L2_COL, CFR_L3_COL)


def cumulative_benchmark_line_labels(data: "P1Data") -> tuple[str, str, str]:
    """Legend labels for the three benchmark lines in Section I (cumulative returns).

    CFR mode (bridge-from-gross-to-residual visualization): each line is the
    cumulative L1/L2/L3 combined factor return — they nest by construction and
    together with the stock's gross return and the L3 residual return form a
    complete additive decomposition:
        gross = L1_cfr + (L2_cfr - L1_cfr) + (L3_cfr - L2_cfr) + l3_residual
              = L3_cfr + l3_residual

    Labels name the factor set at each level:
        L1: Factor(SPY)
        L2: Cum Factor(SPY, {sector_etf})     — e.g. XLK for AAPL
        L3: Cum Factor(SPY, {sector_etf}, {subsector_etf})  — e.g. RSPT for AAPL

    Gross fallback: independent ETF tracks ("SPY", sec, sub). The lines do not
    stack and have no algebraic relationship to the L3 Residual Return line, so
    labelling them as "SPY+sec+sub" would mislead viewers. We keep the fallback
    labels minimal because they should rarely be seen post-rebuild (CFR is now
    the default path for in-mask symbols).

    When ``subsector_etf == sector_etf`` (no distinct subsector ETF) the L3
    label omits the duplicate: "L3 Cum Factor(SPY, XLK)" instead of
    "L3 Cum Factor(SPY, XLK, XLK)". The caller may still choose to skip the
    line entirely since L3 == L2 in that case.
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


def fetch_macro_correlations_resilient(
    client: Any,
    ticker: str,
) -> tuple[dict[str, float | None], str]:
    """Macro factor correlations for snapshots: L3 residual (252→63d), then gross.

    Each ``l3_residual`` attempt catches :class:`APIError` so one HTTP failure
    (e.g. 400 when subsector metadata is missing) does not skip the gross
    return fallback — otherwise the macro block renders empty for some tickers.
    """
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

    # Gross fallback — wider window chain (252 → 126 → 63)
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

    # All attempts failed — log diagnostics from last response
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
# Data contract
# ---------------------------------------------------------------------------

@dataclass
class P1Data:
    """All data needed to render the P1 Stock Performance snapshot.

    Produced by get_data_for_p1(). Consumed by render_p1_to_pdf().
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
        )


# ---------------------------------------------------------------------------
# Fetch step
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
) -> "P1Data":
    """Assemble :class:`P1Data` from a :class:`StockContext` using the same rules as production.

    Production path: :func:`fetch_stock_context` → this function with ``client`` set
    (rankings + macro fetched via API).

    Zarr path: :func:`riskmodels.snapshots.zarr_context.fetch_stock_context_zarr` → this
    function with ``client=None``, pre-filled ``rankings`` and macro from
    ``ds_macro_factor.zarr`` (gold may be absent in zarr).
    """
    import warnings

    m = ctx.metrics
    vol_23d = m.get("vol_23d")

    # Trim all series to last 252 trading days for 1Y charts
    def _tail(df: pd.DataFrame | None, days: int = 252) -> pd.DataFrame | None:
        if df is None or df.empty:
            return df
        return df.iloc[-days:].reset_index(drop=True)

    hist    = _tail(ctx.history)
    spy_df  = _tail(ctx.spy_returns)
    sec_df  = _tail(ctx.sector_returns)
    sub_df  = _tail(ctx.subsector_returns)

    # ── Cumulative returns ──────────────────────────────────────────
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
        # Gross ETF fallback. The Section I chart will (a) relabel the lines as
        # independent ETF tracks rather than stacked L1/L2/L3 contributions and
        # (b) hide the L3 Residual Return line, since it only reconciles
        # arithmetically against CFR-mode benchmarks.
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

    # ── Trailing returns (use full 2Y history for window coverage) ──
    tr_stock     = trailing_returns(ctx.history, WINDOWS)
    tr_spy       = trailing_returns(ctx.spy_returns, WINDOWS)
    tr_sector    = trailing_returns(ctx.sector_returns, WINDOWS)
    tr_subsector = trailing_returns(ctx.subsector_returns, WINDOWS)

    # ── Drawdown ────────────────────────────────────────────────────
    def _dd(df: pd.DataFrame | None) -> list[tuple[str, float]]:
        if df is None or df.empty:
            return []
        dd = max_drawdown_series(df)
        dates = df["date"] if "date" in df.columns else df.index
        return _series_to_list(dates, dd)

    dd_stock = _dd(hist)
    dd_spy   = _dd(spy_df)

    # ── Sharpe (63-day rolling, latest value) ───────────────────────
    sharpe_1y: float | None = None
    if hist is not None and not hist.empty:
        sh = rolling_sharpe(hist, window=min(63, len(hist)))
        if not sh.empty and not pd.isna(sh.iloc[-1]):
            sharpe_1y = float(sh.iloc[-1])

    # ── Max drawdown over the 1Y window ────────────────────────────
    max_dd: float | None = None
    if dd_stock:
        max_dd = min(v for _, v in dd_stock)

    ticker = ctx.ticker

    # ── Rankings (API) or preloaded (e.g. ERM3 zarr) ──────────────────
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

    # ── Macro correlations — API unless explicitly supplied (zarr: pass ``{}``) ──
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

    # ── L3 explained-return attribution series ─────────────────────
    # l3_*_er columns are HR proportions (sum ≈ 1.0 per day).
    # Multiply by gross return to get actual daily explained returns per factor.
    l3_er_series: list[tuple[str, float, float, float, float]] = []
    if hist is not None and not hist.empty:
        er_cols = ["l3_market_er", "l3_sector_er", "l3_subsector_er", "l3_residual_er"]
        ret_col = "returns_gross"
        if all(c in hist.columns for c in er_cols) and ret_col in hist.columns:
            dates_col = hist["date"] if "date" in hist.columns else hist.index
            for d_val, ret_v, mkt_hr, sec_hr, sub_hr, res_hr in zip(
                dates_col,
                hist[ret_col],
                hist["l3_market_er"], hist["l3_sector_er"],
                hist["l3_subsector_er"], hist["l3_residual_er"],
            ):
                if any(pd.isna(v) for v in [ret_v, mkt_hr, sec_hr, sub_hr, res_hr]):
                    continue
                # Explained return = HR proportion × gross return
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


def get_data_for_p1(ticker: str, client: Any, *, years: int = 2) -> "P1Data":
    """Fetch everything needed for the P1 Stock Performance snapshot (API)."""
    ctx = fetch_stock_context(ticker, client, years=years, include_spy=True)
    return build_p1_data_from_stock_context(ctx, client)


# ---------------------------------------------------------------------------
# P1 insight generation — data-driven subheaders for each panel
# ---------------------------------------------------------------------------

@dataclass
class P1Insights:
    """Per-panel subheaders + cross-panel summary for P1.

    Built from P1Data alone — no network calls. Used to replace the
    static italic subheader text in the render with data-driven commentary.
    """
    cum_insight:    str = ""   # I. Cumulative Returns
    attr_insight:   str = ""   # II. L3 Return Attribution
    dd_insight:     str = ""   # III. Drawdown
    summary:        str = ""   # Left panel headline / cross-panel "so what"


def _generate_p1_insights(data: P1Data) -> P1Insights:
    """Build connected data-driven insights across all P1 panels."""
    ticker = data.ticker
    sub    = data.subsector_label
    teo    = data.teo

    tr_1y_stock = data.tr_stock.get("1y")
    tr_1y_spy   = data.tr_spy.get("1y")
    tr_1y_bench = data.tr_subsector.get("1y") or data.tr_sector.get("1y")

    rank_1y_total = data.rankings.get("252d_subsector_gross_return")
    rank_1y_res   = data.rankings.get("252d_subsector_subsector_residual") \
                    or data.rankings.get("252d_subsector_sector_residual")

    def _safe_float(d, key):
        v = d.get(key) if d else None
        if v is None:
            return None
        try:
            f = float(v)
            return None if (f != f) else f  # NaN check
        except (TypeError, ValueError):
            return None

    rank_pct_total = _safe_float(rank_1y_total, "rank_percentile")
    rank_pct_res   = _safe_float(rank_1y_res, "rank_percentile")
    _cohort_f      = _safe_float(rank_1y_total, "cohort_size")
    cohort_n       = int(_cohort_f) if _cohort_f is not None else None

    # Cumulative attribution totals from l3_er_series
    cum_mkt = cum_sec = cum_sub = cum_res = 0.0
    for r in data.l3_er_series:
        cum_mkt += r[1] * 100
        cum_sec += r[2] * 100
        cum_sub += r[3] * 100
        cum_res += r[4] * 100
    total_attributed = cum_mkt + cum_sec + cum_sub + cum_res

    # ── I. Cumulative Returns ─────────────────────────────────────────
    # Endpoint values from each chart line — when CFR mode is on these are
    # the orthogonalized L1/L2/L3 cumulative factor returns (NOT gross ETF
    # returns), so the subheader's bridge story matches what's plotted.
    def _last_val(series):
        if not series:
            return None
        try:
            return float(series[-1][1])
        except (TypeError, ValueError, IndexError):
            return None

    cum_data = {
        "stock_return_1y":     tr_1y_stock,
        "spy_return_1y":       tr_1y_spy,
        "bench_return_1y":     tr_1y_bench,
        "rank_percentile_1y":  rank_pct_total,
        "cohort_size":         cohort_n,
        # Bridge-mode inputs (consumed by _rule_cumulative_returns)
        "cfr_mode":            data.cumulative_bench_lines_use_cfr,
        "l1_cfr_end":          _last_val(data.cum_spy),
        "l2_cfr_end":          _last_val(data.cum_sector),
        "l3_cfr_end":          _last_val(data.cum_subsector),
        "residual_end":        cum_res / 100.0,  # cum_res is in pct → back to decimal
        "sector_label":        data.sector_etf or "sector",
        "subsector_label":     data.subsector_label,
    }
    cum_text = generate_subheader(
        "cumulative_returns", "Cumulative Returns", cum_data,
        data_as_of=teo, time_range="past 252 trading days",
        ticker=ticker, benchmark=sub,
    )

    # ── II. L3 Return Attribution ─────────────────────────────────────
    attr_data = {
        "cum_mkt_pct":        round(cum_mkt, 2),
        "cum_res_pct":        round(cum_res, 2),
        "total_return_pct":   round(tr_1y_stock * 100, 2) if tr_1y_stock else None,
        "rank_percentile_res": rank_pct_res,
    }
    attr_text = generate_subheader(
        "return_attribution", "L3 Return Attribution", attr_data,
        data_as_of=teo, time_range="past 252 trading days",
        ticker=ticker, benchmark=sub,
    )

    # ── III. Drawdown ─────────────────────────────────────────────────
    spy_max_dd = min((v for _, v in data.dd_spy), default=None) if data.dd_spy else None
    dd_data = {
        "max_drawdown": data.max_drawdown,
        "spy_max_dd":   spy_max_dd,
        "sharpe_1y":    data.sharpe_1y,
    }
    dd_text = generate_subheader(
        "drawdown", "Drawdown", dd_data,
        data_as_of=teo, time_range="past 252 trading days",
        ticker=ticker, benchmark=sub,
    )

    # ── Cross-panel summary ───────────────────────────────────────────
    summary_parts = []

    if tr_1y_stock is not None:
        pct_1y = tr_1y_stock * 100
        vs_spy  = (tr_1y_stock - tr_1y_spy) * 100 if tr_1y_spy else None
        perf_clause = f"{ticker} returned {pct_1y:+.1f}% over the past year"
        if vs_spy is not None:
            rel = "outperforming" if vs_spy > 0 else "underperforming"
            perf_clause += f", {rel} SPY by {abs(vs_spy):.1f}pp"
        summary_parts.append(perf_clause + ".")

    if rank_pct_total is not None:
        from ..visuals.smart_subheader import _ordinal
        n_str = f" of {cohort_n}" if cohort_n else ""
        tier = "top" if rank_pct_total >= 67 else ("bottom" if rank_pct_total <= 33 else "mid")
        summary_parts.append(
            f"Ranks {_ordinal(rank_pct_total)} pct ({tier}-third{n_str}) on 1Y return vs {sub} peers."
        )
    elif tr_1y_bench is not None:
        vs_b = (tr_1y_stock - tr_1y_bench) * 100 if tr_1y_stock else None
        if vs_b is not None:
            rel = "ahead of" if vs_b > 0 else "behind"
            summary_parts.append(f"{abs(vs_b):.1f}pp {rel} {sub} benchmark.")

    if abs(cum_res) > 1.0:
        res_dir = "positive" if cum_res > 0 else "negative"
        summary_parts.append(
            f"Idiosyncratic alpha: {cum_res:+.1f}% ({res_dir} residual contribution)."
        )

    summary = " ".join(summary_parts)

    return P1Insights(
        cum_insight=cum_text,
        attr_insight=attr_text,
        dd_insight=dd_text,
        summary=summary,
    )


# ---------------------------------------------------------------------------
# Chart builders — each returns a standalone go.Figure
# ---------------------------------------------------------------------------

def _make_cum_chart(data: P1Data) -> go.Figure:
    """I. Cumulative Returns — multi-line: stock vs SPY vs sector vs subsector vs L3 residual."""
    pal  = T.palette
    fnt  = T.fonts

    def _trace(series: list[tuple[str, float]], name: str, color: str,
                width: float = 2, dash: str = "solid") -> go.Scatter | None:
        if not series:
            return None
        dates = [r[0] for r in series]
        vals  = [r[1] * 100 for r in series]
        return go.Scatter(
            x=dates, y=vals, name=name, mode="lines",
            line=dict(color=color, width=width, dash=dash),
            hovertemplate=f"<b>{name}</b>: %{{y:.1f}}%<extra></extra>",
        )

    # Geometric L3 residual: prod_gross(t) - prod_L3(t) at each step.
    # Matches the waterfall's sequential-compounding definition so the
    # residual line endpoint equals the residual bar exactly.
    res_cum_series: list[tuple[str, float]] = []
    if data.l3_er_series:
        prod_l3 = 1.0
        prod_gross = 1.0
        for r in data.l3_er_series:
            mkt, sec, sub, res = r[1], r[2], r[3], r[4]
            prod_l3 *= (1 + mkt + sec + sub)
            prod_gross *= (1 + mkt + sec + sub + res)
            res_cum_series.append((r[0], prod_gross - prod_l3))

    s_stock = series_with_zero_start(data.cum_stock)
    s_spy = series_with_zero_start(data.cum_spy)      # L1 CFR in CFR mode, else SPY gross
    s_sec = series_with_zero_start(data.cum_sector)   # L2 CFR in CFR mode, else sector ETF gross
    s_sub = series_with_zero_start(data.cum_subsector) # L3 CFR in CFR mode, else subsector ETF gross
    s_res = series_with_zero_start(res_cum_series)

    lab_spy, lab_sec, lab_sub = cumulative_benchmark_line_labels(data)

    # Section I = "bridge from gross to L3 residual return": Gross line on top,
    # L1/L2/L3 cumulative factor return lines below it (or between), and the
    # L3 residual return line showing the unexplained portion. All five lines
    # together form the methodical decomposition the user sees when reading
    # left-to-right in the legend.
    #
    # L3 trace is hidden only if the stock has no distinct subsector ETF
    # (sector_etf == subsector_etf), in which case L3 CFR == L2 CFR
    # mathematically and the duplicate line adds no information.
    show_sub = bool(data.subsector_etf) and data.subsector_etf != data.sector_etf
    # L3 residual line is always shown when we have the data. In gross-fallback
    # mode it still represents the factor-unexplained portion of the stock
    # return (computed via HR proportions × gross return), so it's meaningful
    # even without CFR time series.
    show_res = bool(res_cum_series)

    traces = [
        _trace(s_stock, f"Gross ({data.ticker})", pal.navy,  width=3.0),
        _trace(s_spy,   lab_spy,                  "#888888", width=1.5, dash="dot"),
        _trace(s_sec,   lab_sec,                  pal.teal,  width=1.5, dash="dash"),
    ]
    if show_sub:
        traces.append(_trace(s_sub, lab_sub, pal.slate, width=1.5, dash="dashdot"))
    if show_res:
        traces.append(_trace(s_res, "L3 Residual Return", pal.green, width=2.0, dash="solid"))

    fig = go.Figure()
    for t in traces:
        if t is not None:
            fig.add_trace(t)

    annotation_specs: list[tuple[list[tuple[str, float]], str, str]] = [
        (s_stock, pal.navy,  " "),
        (s_spy,   "#888888", " "),
        (s_sec,   pal.teal,  " "),
    ]
    if show_sub:
        annotation_specs.append((s_sub, pal.slate, " "))
    if show_res:
        annotation_specs.append((s_res, pal.green, " "))

    # Annotate period-end values on the right axis
    for series, color, prefix in annotation_specs:
        if series:
            last_date, last_val = series[-1][0], series[-1][1] * 100
            fig.add_annotation(
                x=last_date, y=last_val, xanchor="left", yanchor="middle",
                text=f"{prefix}{last_val:+.1f}%", showarrow=False,
                font=dict(family=fnt.family, size=fnt.annotation, color=color),
            )

    T.style(fig)
    fig.update_layout(
        yaxis=dict(
            title="Cumulative Return (%)",
            zeroline=True, zerolinecolor="#dddddd", zerolinewidth=1,
            ticksuffix="%", tickfont=dict(size=fnt.axis_tick),
        ),
        xaxis=dict(title=None, showgrid=False),
        legend=dict(
            orientation="h", yanchor="bottom", y=-0.22,
            xanchor="center", x=0.5, bgcolor="rgba(0,0,0,0)", borderwidth=0,
            font=dict(size=fnt.body),
        ),
        hovermode="x unified",
    )
    return fig


def _make_cum_waterfall(data: P1Data) -> go.Figure:
    """I (right). Hierarchical Geometric Attribution bridge.

    Decomposes gross compound return into Market → Sector → Subsector →
    Residual using sequential compounding that respects the ERM3 orthogonal
    hierarchy.  Each bar = telescoping difference between cumulative products
    at adjacent hierarchy levels, so bars sum exactly to the geometric gross.

    Math:
        prod_L1 = ∏(1 + mkt_t)
        prod_L2 = ∏(1 + mkt_t + sec_t)
        prod_L3 = ∏(1 + mkt_t + sec_t + sub_t)
        prod_G  = ∏(1 + gross_t)

        mkt_bar = prod_L1 - 1
        sec_bar = prod_L2 - prod_L1       (telescopes)
        sub_bar = prod_L3 - prod_L2
        res_bar = prod_G  - prod_L3
        Σ bars  = prod_G  - 1  ≡ gross compound return  ✓
    """
    pal = T.palette
    fnt = T.fonts

    # Sequential compounding through the ERM3 hierarchy.
    # Each product compounds returns as if only factors up to that level exist.
    prod_l1 = 1.0    # Market only
    prod_l2 = 1.0    # Market + Sector
    prod_l3 = 1.0    # Market + Sector + Subsector
    prod_gross = 1.0  # All factors (= actual gross)
    for _date, mkt, sec, sub, res in data.l3_er_series:
        prod_l1 *= (1 + mkt)
        prod_l2 *= (1 + mkt + sec)
        prod_l3 *= (1 + mkt + sec + sub)
        prod_gross *= (1 + mkt + sec + sub + res)

    # Telescoping differences — sum exactly to geometric gross
    mkt_pct = (prod_l1 - 1) * 100
    sec_pct = (prod_l2 - prod_l1) * 100
    sub_pct = (prod_l3 - prod_l2) * 100
    res_pct = (prod_gross - prod_l3) * 100
    gross_pct = (prod_gross - 1) * 100

    # Short ETF-ticker labels — hierarchy implied by waterfall order
    sector_label = data.sector_etf or "Sector"
    sub_label = data.subsector_etf or "Sub"
    show_sub = bool(data.subsector_etf) and data.subsector_etf != data.sector_etf

    labels = ["SPY", sector_label]
    values = [mkt_pct, sec_pct]
    colors = [pal.navy, pal.teal]

    if show_sub:
        labels.append(sub_label)
        values.append(sub_pct)
        colors.append(pal.slate)

    labels.append("α Residual")
    values.append(res_pct)
    colors.append(pal.green if res_pct >= 0 else pal.orange)

    # 5th position: "Gross" column — no bar, just a label and dashed line.
    # This gives the gross annotation its own space, clear of the residual bar.
    labels.append(f"Gross")
    values.append(0.0)        # zero-height (invisible)
    colors.append("rgba(0,0,0,0)")

    # Build waterfall geometry — stacked bars for per-bar colors.
    bases: list[float] = []
    running = 0.0
    n_real = len(values) - 1  # exclude the phantom gross position
    for i, val in enumerate(values):
        if i < n_real:
            bases.append(running if val >= 0 else running + val)
            running += val
        else:
            bases.append(0.0)  # phantom gross bar base at 0

    # Dynamic inside/outside threshold: bar must be ≥15% of the y-range
    all_tops = [b + abs(v) for b, v in zip(bases[:n_real], values[:n_real])]
    all_bottoms = list(bases[:n_real])
    y_range = max(max(all_tops), 0) - min(min(all_bottoms), 0)
    inside_threshold = y_range * 0.15 if y_range > 0 else 1.0

    text_positions = []
    text_labels = []
    for i, v in enumerate(values):
        if i < n_real:
            text_positions.append("inside" if abs(v) >= inside_threshold else "outside")
            text_labels.append(f"<b>{v:+.1f}%</b>")
        else:
            text_positions.append("none")  # hide text on phantom bar
            text_labels.append("")

    fig = go.Figure()
    # Invisible base bars
    fig.add_trace(go.Bar(
        x=labels, y=bases,
        marker=dict(color="rgba(0,0,0,0)"),
        showlegend=False, hoverinfo="skip",
    ))
    # Visible bars (phantom gross bar is transparent)
    fig.add_trace(go.Bar(
        x=labels, y=[abs(v) for v in values],
        marker=dict(color=colors, line=dict(width=0)),
        text=text_labels,
        textposition=text_positions,
        textfont=dict(family=fnt.family, size=fnt.body),
        insidetextfont=dict(family=fnt.family, size=fnt.body, color="#ffffff"),
        outsidetextfont=dict(family=fnt.family, size=fnt.body, color=pal.text_dark),
        showlegend=False,
        hovertemplate="%{x}: %{text}<extra></extra>",
        cliponaxis=False,
    ))

    # Connector lines between real bars only
    for i in range(n_real - 1):
        y_conn = bases[i] + abs(values[i])
        fig.add_shape(
            type="line",
            x0=i, x1=i + 1, y0=y_conn, y1=y_conn,
            xref="x", yref="y",
            line=dict(color=pal.border, width=1, dash="dot"),
        )

    # Gross dashed reference line — full width
    fig.add_shape(
        type="line",
        x0=0.0, x1=1.0, y0=gross_pct, y1=gross_pct,
        xref="paper", yref="y",
        line=dict(color=pal.navy, width=0.8, dash="dot"),
    )
    # Gross value label centered over the 5th "Gross" column
    gross_idx = len(values) - 1
    fig.add_annotation(
        x=gross_idx, y=gross_pct,
        text=f"<b>{gross_pct:+.1f}%</b>",
        showarrow=False, xanchor="center", yanchor="bottom",
        yshift=3,
        font=dict(family=fnt.family, size=fnt.body + 1, color=pal.navy),
    )

    T.style(fig)
    fig.update_layout(
        barmode="stack",
        margin=dict(t=8, r=6),
        bargap=0.28,
        yaxis=dict(
            zeroline=True, zerolinecolor="#dddddd", zerolinewidth=1,
            ticksuffix="%", tickfont=dict(size=fnt.axis_tick),
        ),
        xaxis=dict(title=None, tickfont=dict(size=fnt.axis_tick)),
        showlegend=False,
    )
    return fig


def _make_l3_evolution_chart(data: P1Data) -> go.Figure:
    """II. L3 Return Attribution — cumulative explained-return by factor over 252 days.

    Each line = running total of that factor's contribution (HR proportion × daily gross return).
    Total of all 4 lines = cumulative gross return of the stock.
    """
    pal = T.palette
    fig = go.Figure()

    if not data.l3_er_series:
        fig.add_annotation(
            text="L3 attribution data unavailable", xref="paper", yref="paper",
            x=0.5, y=0.5, showarrow=False,
            font=dict(size=18, color=pal.text_light),
        )
        T.style(fig)
        return fig

    dates = [r[0] for r in data.l3_er_series]

    def _cumsum_pct(idx: int) -> list[float]:
        total = 0.0
        out = []
        for r in data.l3_er_series:
            total += r[idx] * 100
            out.append(round(total, 4))
        return out

    mkt_cum = _cumsum_pct(1)
    sec_cum = _cumsum_pct(2)
    sub_cum = _cumsum_pct(3)
    res_cum = _cumsum_pct(4)

    fnt  = T.fonts

    # Stacked cumulative areas — each layer sits on top of the previous
    stk_mkt = mkt_cum
    stk_sec = [m + s             for m, s        in zip(mkt_cum, sec_cum)]
    stk_sub = [m + s + u         for m, s, u     in zip(mkt_cum, sec_cum, sub_cum)]
    stk_res = [m + s + u + r     for m, s, u, r  in zip(mkt_cum, sec_cum, sub_cum, res_cum)]

    # Official R1 factor palette — vivid, high-contrast
    layers = [
        ("Market",    stk_mkt, pal.navy,  "rgba(0,42,94,0.70)",    "tozeroy"),
        ("Sector",    stk_sec, pal.teal,  "rgba(0,111,142,0.65)",  "tonexty"),
        ("Subsector", stk_sub, pal.slate, "rgba(42,127,191,0.60)", "tonexty"),
        ("Residual",  stk_res, pal.green, "rgba(0,170,0,0.65)",    "tonexty"),
    ]
    for name, vals, line_color, fill_rgba, fill_mode in layers:
        fig.add_trace(go.Scatter(
            x=dates, y=vals, name=name, mode="lines",
            line=dict(color=line_color, width=1.2),
            fill=fill_mode, fillcolor=fill_rgba,
            hovertemplate=f"<b>{name}</b>: %{{y:.2f}}%<extra></extra>",
        ))

    # Period-end residual annotation (the alpha signal)
    if stk_res and res_cum:
        last_res = res_cum[-1]
        res_color = pal.green if last_res >= 0 else pal.orange
        fig.add_annotation(
            xref="paper", x=1.01, y=stk_res[-1], xanchor="left", yanchor="middle",
            text=f"α {last_res:+.1f}%", showarrow=False,
            font=dict(family=fnt.family, size=fnt.annotation, color=res_color),
        )

    T.style(fig)
    fig.update_layout(
        yaxis=dict(
            title="Cumulative Return Attribution (%)",
            zeroline=True, zerolinecolor="#dddddd", zerolinewidth=1,
            ticksuffix="%", tickfont=dict(size=fnt.axis_tick),
        ),
        xaxis=dict(title=None, showgrid=False),
        legend=dict(
            orientation="h", yanchor="bottom", y=-0.25,
            xanchor="center", x=0.5, bgcolor="rgba(0,0,0,0)", borderwidth=0,
            font=dict(size=fnt.body),
        ),
        hovermode="x unified",
    )
    return fig


def _make_drawdown_chart(data: P1Data) -> go.Figure:
    """III. Drawdown — underwater equity curve with max DD annotation."""
    pal = T.palette
    fnt = T.fonts

    fig = go.Figure()

    # SPY first so it renders behind
    if data.dd_spy:
        spy_dates = [r[0] for r in data.dd_spy]
        spy_vals  = [r[1] * 100 for r in data.dd_spy]
        fig.add_trace(go.Scatter(
            x=spy_dates, y=spy_vals, name="SPY", mode="lines",
            line=dict(color="#999999", width=1.2, dash="dot"),
            hovertemplate="<b>SPY</b>: %{y:.1f}%<extra></extra>",
        ))

    # Stock — red fill to signal drawdown as risk event
    if data.dd_stock:
        dates = [r[0] for r in data.dd_stock]
        vals  = [r[1] * 100 for r in data.dd_stock]
        fig.add_trace(go.Scatter(
            x=dates, y=vals, name=data.ticker, mode="lines",
            line=dict(color=pal.red, width=2),
            fill="tozeroy",
            fillcolor="rgba(204,41,54,0.12)",
            hovertemplate=f"<b>{data.ticker}</b>: %{{y:.1f}}%<extra></extra>",
        ))

        # Max DD horizontal reference line + callout
        if data.max_drawdown is not None:
            max_dd_pct = data.max_drawdown * 100
            spy_max_dd = min((r[1] for r in data.dd_spy), default=None) if data.dd_spy else None
            spy_str = f" vs SPY {spy_max_dd*100:.1f}%" if spy_max_dd is not None else ""
            callout = f"Max DD: {max_dd_pct:.1f}%{spy_str}"

            fig.add_shape(
                type="line", xref="paper", x0=0, x1=1,
                y0=max_dd_pct, y1=max_dd_pct,
                line=dict(color=pal.orange, width=1.2, dash="dot"),
            )
            fig.add_annotation(
                xref="paper", x=0.02, y=max_dd_pct,
                text=callout, showarrow=False, xanchor="left", yanchor="top",
                font=dict(family=fnt.family, size=fnt.annotation, color=pal.orange),
                bgcolor="rgba(255,255,255,0.85)",
                bordercolor=pal.orange, borderwidth=1, borderpad=3,
            )

    T.style(fig)
    fig.update_layout(
        yaxis=dict(
            title="Drawdown (%)",
            zeroline=True, zerolinecolor="#dddddd", zerolinewidth=1,
            ticksuffix="%",
        ),
        xaxis=dict(title=None, showgrid=False),
        legend=dict(
            orientation="h", yanchor="bottom", y=-0.25,
            xanchor="center", x=0.5, bgcolor="rgba(0,0,0,0)", borderwidth=0,
        ),
    )
    return fig


# ---------------------------------------------------------------------------
# Left panel helpers
# ---------------------------------------------------------------------------

def _fmt_market_cap(v: Any) -> str:
    if v is None:
        return "—"
    try:
        v = float(v)
    except (TypeError, ValueError):
        return "—"
    if v >= 1e12:
        return f"${v/1e12:.1f}T"
    if v >= 1e9:
        return f"${v/1e9:.1f}B"
    if v >= 1e6:
        return f"${v/1e6:.1f}M"
    return f"${v:,.0f}"


def _fmt_pct(v: float | None, decimals: int = 1) -> str:
    if v is None:
        return "—"
    return f"{v*100:+.{decimals}f}%"


def _fmt_num(v: float | None, decimals: int = 2) -> str:
    if v is None:
        return "—"
    return f"{v:.{decimals}f}"


# ---------------------------------------------------------------------------
# Page compositor
# ---------------------------------------------------------------------------

def _pct_ordinal(pct: float) -> str:
    """Format 73.4 → '73rd pct'."""
    n = int(round(pct))
    if 11 <= (n % 100) <= 13:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix} pct"


def _sharpe_qualifier(sh: float | None) -> str:
    """Return a qualitative label for a Sharpe ratio."""
    if sh is None:
        return ""
    if sh > 1.0:
        return "strong"
    if sh > 0.3:
        return "adequate"
    if sh > 0.0:
        return "weak"
    return "poor"


def _compose_p1_page(data: P1Data) -> SnapshotComposer:
    """Compose the P1 snapshot using Pillow layout + Plotly charts."""
    apply_theme()

    insights = _generate_p1_insights(data)

    m    = data.metrics
    pal  = T.palette

    W, H    = 3300, 2550
    MARGIN  = 150
    PANEL_W = 800
    PANEL_GAP = 50
    CONTENT_X = MARGIN + PANEL_W + PANEL_GAP
    CONTENT_W = W - CONTENT_X - MARGIN

    page = SnapshotComposer(W, H)
    y    = 80

    # ════════════════════════════════════════════════════════════════
    # HEADER (full width)
    # ════════════════════════════════════════════════════════════════
    page.text(MARGIN, y, f"{data.ticker} — {data.company_name}",
              font_size=72, bold=True, color=NAVY)
    page.text_right(W - MARGIN, y + 12, "P1 · Stock Performance",
                    font_size=42, color=TEXT_MID)
    y += 90

    page.text(MARGIN, y,
              f"Ticker: {data.ticker}  ·  Benchmark: {data.subsector_label}  ·  As of: {data.teo}",
              font_size=32, color=TEXT_MID)
    y += 55

    page.hline(y, x0=MARGIN, x1=W - MARGIN, color=NAVY, thickness=6)
    y += 20

    after_header_y = y

    # ════════════════════════════════════════════════════════════════
    # LEFT PANEL background + vertical divider
    # ════════════════════════════════════════════════════════════════
    panel_right = MARGIN + PANEL_W
    page.rect(MARGIN - 10, after_header_y, PANEL_W + 10, H - 90 - after_header_y,
              fill=(248, 249, 251))
    div_x = CONTENT_X - PANEL_GAP // 2
    page.draw.rectangle([div_x, after_header_y, div_x + 1, H - 90], fill=BORDER)

    # ── Left panel contents ──────────────────────────────────────────
    py     = after_header_y + 20
    ROW_H  = 50
    LBL_SZ = 28
    VAL_SZ = 28
    SEC_SZ = 22

    def _panel_row(label: str, val_str: str, val_color=TEXT_DARK):
        nonlocal py
        page.text(MARGIN, py, label, font_size=LBL_SZ, color=TEXT_MID)
        page.text_right(panel_right, py, val_str, font_size=VAL_SZ, bold=True, color=val_color)
        py += ROW_H

    def _section(title: str):
        nonlocal py
        page.text(MARGIN, py, title, font_size=SEC_SZ, bold=True, color=TEXT_LIGHT)
        py += int(SEC_SZ * 1.4)
        page.hline(py, x0=MARGIN, x1=panel_right, color=BORDER, thickness=1)
        py += 10

    # Company name + ticker/date
    page.text(MARGIN, py, data.company_name,
              font_size=42, bold=True, color=NAVY, max_width=PANEL_W)
    py += int(42 * 1.4)
    page.text(MARGIN, py, f"{data.ticker}  ·  {data.teo}",
              font_size=LBL_SZ, color=TEXT_MID)
    py += int(LBL_SZ * 1.4) + 16

    # IDENTITY
    _section("IDENTITY")
    mkt_cap_str = _fmt_market_cap(m.get("market_cap"))
    _panel_row("Market Cap",     mkt_cap_str)
    _panel_row("Sector ETF",     data.sector_etf or "—")
    _panel_row("Subsector ETF",  data.subsector_etf or "—")
    py += 16

    # PERFORMANCE STATS
    _section("PERFORMANCE STATS")
    tr = data.tr_stock
    vol_str    = _fmt_pct(data.vol_23d / (252**0.5) if data.vol_23d else None)  # daily vol — actually show annualised
    vol_str    = f"{data.vol_23d*100:.1f}%" if data.vol_23d else "—"
    _sh = data.sharpe_1y
    sharpe_str = _fmt_num(_sh) + (f" · {_sharpe_qualifier(_sh)}" if _sh is not None else "")
    max_dd_str = _fmt_pct(data.max_drawdown)

    price = m.get("close_price")
    price_str = f"${float(price):.2f}" if price else "—"

    _panel_row("Last Price",     price_str)
    _panel_row("Vol (23d ann.)", vol_str)
    _panel_row("Sharpe (63d)",   sharpe_str,
               val_color=GREEN_RGB if (data.sharpe_1y or 0) > 0.5 else ORANGE_RGB if (data.sharpe_1y or 0) < 0 else TEXT_DARK)
    _panel_row("Max Drawdown",   max_dd_str,
               val_color=ORANGE_RGB if (data.max_drawdown or 0) < -0.15 else TEXT_DARK)
    py += 16

    # TRAILING RETURNS (stock vs SPY)
    _section("TRAILING RETURNS")
    # Header row
    page.text(MARGIN, py, "Period", font_size=SEC_SZ, color=TEXT_LIGHT)
    page.text(MARGIN + int(PANEL_W * 0.38), py, data.ticker, font_size=SEC_SZ, bold=True, color=NAVY)
    page.text(MARGIN + int(PANEL_W * 0.57), py, "SPY", font_size=SEC_SZ, color=TEXT_MID)
    page.text_right(panel_right, py, "vs SPY", font_size=SEC_SZ, color=TEXT_LIGHT)
    py += int(SEC_SZ * 1.5) + 4
    page.hline(py, x0=MARGIN, x1=panel_right, color=BORDER, thickness=1)
    py += 8

    tr_row_h = 44
    for wl in WINDOW_LABELS:
        sv = data.tr_stock.get(wl)
        bv = data.tr_spy.get(wl)
        spread = (sv - bv) if (sv is not None and bv is not None) else None

        sv_col = GREEN_RGB if (sv or 0) > 0 else ORANGE_RGB
        sp_col = GREEN_RGB if (spread or 0) > 0 else ORANGE_RGB

        page.text(MARGIN, py, wl.upper(), font_size=LBL_SZ, bold=True, color=TEXT_DARK)
        page.text(MARGIN + int(PANEL_W * 0.38), py, _fmt_pct(sv),
                  font_size=LBL_SZ, color=sv_col)
        page.text(MARGIN + int(PANEL_W * 0.57), py, _fmt_pct(bv),
                  font_size=LBL_SZ, color=TEXT_MID)
        page.text_right(panel_right, py, _fmt_pct(spread),
                        font_size=LBL_SZ, bold=True, color=sp_col)
        py += tr_row_h

    py += 16

    # RANKINGS — multi-window dot matrix (6 windows × 2 metrics)
    _section("RANKINGS — Multi-Window vs Subsector")
    RANK_WINDOWS = [
        ("1d",   "1d"),
        ("5d",   "5d"),
        ("21d",  "1m"),
        ("63d",  "3m"),
        ("126d", "6m"),
        ("252d", "1y"),
    ]
    RANK_METRICS = [
        ("Total Return", "gross_return",         "subsector_gross_return"),
        ("Residual ER",  "subsector_residual",   "subsector_subsector_residual"),
    ]
    DOT_D = 26
    LABEL_W = 170  # px for row label on left
    dots_area_w = PANEL_W - LABEL_W - 10
    dot_spacing = dots_area_w // len(RANK_WINDOWS)
    dot_x_start = MARGIN + LABEL_W

    # Period header row
    for i, (wkey, dlabel) in enumerate(RANK_WINDOWS):
        dot_cx = dot_x_start + i * dot_spacing + dot_spacing // 2
        page.text(dot_cx - 10, py, dlabel, font_size=20, color=TEXT_LIGHT)
    py += 28

    for mlabel, _mkey, rank_suffix in RANK_METRICS:
        page.text(MARGIN, py + (ROW_H - LBL_SZ) // 2, mlabel,
                  font_size=LBL_SZ, color=TEXT_MID)
        for i, (wkey, _dlabel) in enumerate(RANK_WINDOWS):
            rank_key = f"{wkey}_subsector_{rank_suffix}"
            rrow = data.rankings.get(rank_key)
            pct = float(rrow["rank_percentile"]) if (
                rrow and rrow.get("rank_percentile") is not None
            ) else None

            dot_color = (
                GREEN_RGB if pct is not None and pct >= 67 else
                RED_RGB   if pct is not None and pct <= 33 else
                ORANGE_RGB if pct is not None else
                TEXT_LIGHT
            )
            dot_cx = dot_x_start + i * dot_spacing + dot_spacing // 2
            dot_cy = py + (ROW_H - DOT_D) // 2
            page.draw.ellipse(
                [dot_cx - DOT_D // 2, dot_cy,
                 dot_cx + DOT_D // 2, dot_cy + DOT_D],
                fill=dot_color,
            )
        py += ROW_H

    py += 16

    # RISK DECOMPOSITION
    _section("RISK DECOMPOSITION — L3 ER")

    BAR_MAX_W = int(PANEL_W * 0.50)

    def _g(full: str, abbr: str) -> float | None:
        v = m.get(full)
        return v if v is not None else m.get(abbr)

    mkt_er  = _g("l3_market_er",    "l3_mkt_er")
    sec_er  = _g("l3_sector_er",    "l3_sec_er")
    sub_er  = _g("l3_subsector_er", "l3_sub_er")
    res_er  = _g("l3_residual_er",  "l3_res_er")
    er_vals = [abs(float(v)) for v in [mkt_er, sec_er, sub_er, res_er] if v is not None]
    max_er  = max(er_vals) if er_vals else 1.0

    NAVY_T  = (0, 42, 94)
    TEAL_T  = (0, 111, 142)
    SLATE_T = (42, 127, 191)
    GREEN_T = (0, 170, 0)

    def _er_color(v: float | None) -> tuple:
        if v is None:
            return TEXT_LIGHT
        return GREEN_RGB if float(v) >= 0 else ORANGE_RGB

    for er_label, er_val, bar_color in [
        ("Market ER",    mkt_er, NAVY_T),
        ("Sector ER",    sec_er, TEAL_T),
        ("Subsector ER", sub_er, SLATE_T),
        ("Residual ER",  res_er, GREEN_T),
    ]:
        val_str = _fmt_pct(er_val) if er_val is not None else "—"
        vc = _er_color(er_val)

        page.text(MARGIN, py, er_label, font_size=LBL_SZ, color=TEXT_MID)
        page.text_right(panel_right, py, val_str, font_size=VAL_SZ, bold=True, color=vc)

        if er_val is not None:
            bar_h = 10
            bar_y = py + (ROW_H - bar_h) // 2
            bar_w = max(4, int(abs(float(er_val)) / max_er * BAR_MAX_W))
            bar_x = panel_right - bar_w - 90
            page.draw.rectangle([bar_x, bar_y, bar_x + bar_w, bar_y + bar_h], fill=bar_color)

        py += ROW_H
    py += 16

    # MACRO CORRELATIONS
    _section("MACRO CORRELATIONS — L3 Res · 252d")
    MACRO_KEYS  = ["vix", "oil", "gold", "bitcoin", "dxy", "ust10y2y"]
    MACRO_NAMES = {"vix": "VIX", "oil": "Oil", "gold": "Gold",
                   "bitcoin": "Bitcoin", "dxy": "DXY", "ust10y2y": "UST 10y-2y"}
    corrs = data.macro_correlations or {}

    for mkey in MACRO_KEYS:
        corr = corrs.get(mkey)
        mlabel = MACRO_NAMES[mkey]

        if corr is not None:
            corr_f = float(corr)
            val_str = f"{corr_f:+.2f}"
            val_color = GREEN_RGB if corr_f > 0 else ORANGE_RGB
        else:
            corr_f = None
            val_str = "—"
            val_color = TEXT_LIGHT

        page.text(MARGIN, py, mlabel, font_size=LBL_SZ, color=TEXT_MID)
        page.text_right(panel_right, py, val_str, font_size=VAL_SZ, bold=True, color=val_color)

        if corr_f is not None:
            bar_h = 10
            bar_y = py + (ROW_H - bar_h) // 2
            bar_w = max(4, int(abs(corr_f) * BAR_MAX_W))
            bar_x = panel_right - bar_w - 90
            page.draw.rectangle([bar_x, bar_y, bar_x + bar_w, bar_y + bar_h], fill=val_color)

        py += ROW_H

    # ════════════════════════════════════════════════════════════════
    # RIGHT CONTENT AREA
    # ════════════════════════════════════════════════════════════════
    y = after_header_y

    FOOTER_Y  = H - 90
    half_w    = CONTENT_W // 2 - 20
    GAP       = 36   # gap between chart rows

    # ── AI Performance Summary box ──────────────────────────────────
    def _est_lines(text: str, font_size: int, max_width: int) -> int:
        if not text:
            return 0
        chars_per_line = max(1, int(max_width / (font_size * 0.55)))
        words = text.split()
        lines, ll = 1, 0
        for w in words:
            if ll + len(w) + 1 > chars_per_line:
                lines += 1
                ll = len(w)
            else:
                ll += len(w) + 1
        return lines

    import re as _re
    if insights.summary:
        m_sent = _re.search(r'\.\s+(?=[A-Z])', insights.summary)
        if m_sent:
            lead = insights.summary[:m_sent.start() + 1]
            rest = insights.summary[m_sent.end():].strip()
        else:
            lead, rest = insights.summary, ""

        lead_lines = _est_lines(lead, 32, CONTENT_W - 40)
        rest_lines = _est_lines(rest, 28, CONTENT_W - 40) if rest else 0
        box_h = 26 + int(lead_lines * 32 * 1.4) + (int(rest_lines * 28 * 1.4) if rest else 0) + 26
        box_h = max(box_h, 90)

        page.rect(CONTENT_X - 10, y, CONTENT_W + 20, box_h, fill=LIGHT_BG)
        ty = y + 22
        ty = page.text(CONTENT_X + 10, ty, lead,
                       font_size=32, bold=True, color=TEXT_DARK, max_width=CONTENT_W - 40)
        if rest:
            page.text(CONTENT_X + 10, ty + 4, rest,
                      font_size=28, color=TEXT_MID, max_width=CONTENT_W - 40)
        y += box_h + 16

    # Fixed heights for section headers + subheaders + divider
    # Section I:    title(56) + insight(40) = 96
    # Divider:      1 + 20 = 21
    # Section II+III: title(56) + insight(40) = 96
    OVERHEAD = 96 + 21 + 96
    chart_area = FOOTER_Y - y - OVERHEAD - GAP
    chart_h_top = int(chart_area * 0.50)
    chart_h_bot = chart_area - chart_h_top

    # ── Section I: Cumulative Returns ───────────────────────────────
    page.text(CONTENT_X, y, "I. Cumulative Returns",
              font_size=38, bold=True, color=NAVY)
    y += 56
    page.text(CONTENT_X, y, insights.cum_insight,
              font_size=26, italic=True, color=TEAL, max_width=CONTENT_W)
    y += 40

    cum_line_w = int(CONTENT_W * 2 / 3) - 20   # 2/3 for line chart
    cum_wf_w   = CONTENT_W - cum_line_w - 40   # 1/3 for waterfall
    cum_fig = _make_cum_chart(data)
    page.paste_figure(cum_fig, CONTENT_X, y, cum_line_w, chart_h_top)
    if data.l3_er_series:
        wf_fig = _make_cum_waterfall(data)
        page.paste_figure(wf_fig, CONTENT_X + cum_line_w + 40, y, cum_wf_w, chart_h_top)
    y += chart_h_top + GAP

    # ── Section divider ──────────────────────────────────────────────
    page.hline(y, x0=CONTENT_X, x1=W - MARGIN, color=BORDER, thickness=1)
    y += 20

    # ── Sections II + III side by side ──────────────────────────────
    page.text(CONTENT_X, y, "II. L3 Return Attribution",
              font_size=38, bold=True, color=NAVY)
    page.text(CONTENT_X + half_w + 40, y, "III. Drawdown",
              font_size=38, bold=True, color=NAVY)
    y += 56

    page.text(CONTENT_X, y, insights.attr_insight,
              font_size=26, italic=True, color=TEAL, max_width=half_w - 10)
    page.text(CONTENT_X + half_w + 40, y, insights.dd_insight,
              font_size=26, italic=True, color=TEAL, max_width=half_w - 10)
    y += 40

    l3_fig  = _make_l3_evolution_chart(data)
    dd_fig  = _make_drawdown_chart(data)
    page.paste_figure(l3_fig, CONTENT_X,              y, half_w, chart_h_bot)
    page.paste_figure(dd_fig, CONTENT_X + half_w + 40, y, half_w, chart_h_bot)

    # ════════════════════════════════════════════════════════════════
    # FOOTER
    # ════════════════════════════════════════════════════════════════
    footer_y = H - 80
    page.hline(footer_y, x0=MARGIN, x1=W - MARGIN, color=BORDER, thickness=2)
    footer_y += 12
    page.text(MARGIN, footer_y,
              f"ERM3 V3 · {data.teo}  ·  riskmodels.app/ticker/{data.ticker.lower()}",
              font_size=24, color=TEXT_LIGHT)
    page.text_right(W - MARGIN, footer_y,
                    "BW Macro · Confidential · Not Investment Advice",
                    font_size=24, color=TEXT_LIGHT)

    return page


# ---------------------------------------------------------------------------
# Public render API
# ---------------------------------------------------------------------------

def render_p1_to_pdf(data: P1Data, output_path: str | Path) -> Path:
    """Render the P1 Stock Performance snapshot to a PDF file."""
    page = _compose_p1_page(data)
    return page.save(output_path)


def render_p1_to_png(data: P1Data, output_path: str | Path) -> Path:
    """Render the P1 Stock Performance snapshot to a PNG file."""
    page = _compose_p1_page(data)
    return page.save(output_path)


def render_p1_to_png_bytes(data: P1Data) -> bytes:
    """Render the P1 snapshot to PNG bytes in memory."""
    page = _compose_p1_page(data)
    return page.to_png_bytes()
