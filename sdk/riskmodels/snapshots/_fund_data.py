"""Fund snapshot data contract — institutional ``FundData`` for F1 ingestion.

Loads per-fund zarr from ``gs://rm_api_data/ERM3_Funds/...`` plus optional local
Funds_DAG sibling paths for ``funds_latest.json``, ``fund_fit.parquet``, and
identity from ``funds.json``. Institutional BWMACRO renderers optionally chain
:func:`bwmacro.snapshots.funds._data.enrich_fund_data_with_supabase` for ticker + L3
shares backed by RiskModels Supabase reads; pip consumers work without keys.

    get_data_for_f1(bw_fund_id, …) → FundData
"""

from __future__ import annotations

import datetime as _dt
import logging
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Realized fund variance decomposition (matches the canonical /api/snapshot
# "realized_strips" basis — RiskModels_API #52). Computed from the per-filing
# portfolio layer return strips in ds_portfolio.zarr; no "residuals are mutually
# uncorrelated" assumption — var(residual_strip) carries every cross-holding
# residual covariance.
# ---------------------------------------------------------------------------

# ds_portfolio.zarr is sparse (one strip per filing, ≈ quarterly), so this is a
# floor on filing-aligned observations — ~12 ≈ three years.
_MIN_REALIZED_FUND_OBS = 12


def _realized_variance_shares(
    layer_series: list[tuple[str, float, float, float, float, float]],
) -> dict[str, float] | None:
    """Fund variance decomposition from the layer return strips.

    ``layer_series`` is ``[(teo, mkt, sec, sub, style, res), ...]`` — the
    per-filing portfolio layer returns from ``ds_portfolio.zarr``, which sum to
    the portfolio's gross return per period. Each layer's share of fund variance
    is ``cov(strip_k, gross) / var(gross)``; since the ERM3 FF2 (v4) identity is
    ``gross = mkt + sec + sub + style + res`` exactly,
    ``Σ_k cov(strip_k, gross) = cov(gross, gross) = var(gross)``, so the five
    shares sum to exactly 1 before clamping. ``style`` is the FF size(SMB)+
    value(HML) strip; ``res`` is the stock-specific idiosyncratic strip *net of*
    style. ``var(residual_strip)`` is the *realized* portfolio residual variance
    — it already includes every cross-holding residual covariance — so there is
    no uncorrelated-residuals assumption anywhere.

    Pre-v4 funds (cascade_basis ``l3_pre_v4``) carry ``style ≡ 0`` upstream, so
    the style share is ~0 and the decomposition reduces to the old four legs.

    A layer whose strip moved against the portfolio over the window (it hedged)
    has negative covariance → negative share; for a clean shares-of-100% headline
    those are clamped to 0 and the positives renormalized. Returns ``None`` when
    there aren't enough observations or the fund variance is degenerate (caller
    falls back to the naive top-N aggregation).
    """
    if len(layer_series) < _MIN_REALIZED_FUND_OBS:
        return None
    mkt = [float(t[1]) for t in layer_series]
    sec = [float(t[2]) for t in layer_series]
    sub = [float(t[3]) for t in layer_series]
    style = [float(t[4]) for t in layer_series]
    res = [float(t[5]) for t in layer_series]
    gross = [a + b + c + s + d for a, b, c, s, d in zip(mkt, sec, sub, style, res)]
    n = len(gross)
    g_mean = sum(gross) / n
    g_var = sum((g - g_mean) ** 2 for g in gross) / n
    if not (g_var > 1e-15):
        return None

    def _cov_with_gross(a: list[float]) -> float:
        a_mean = sum(a) / n
        return sum((a[i] - a_mean) * (gross[i] - g_mean) for i in range(n)) / n

    raw = {
        "market": _cov_with_gross(mkt) / g_var,
        "sector": _cov_with_gross(sec) / g_var,
        "subsector": _cov_with_gross(sub) / g_var,
        "style": _cov_with_gross(style) / g_var,
        "residual": _cov_with_gross(res) / g_var,
    }
    clamped = {k: max(0.0, v) for k, v in raw.items()}
    total = sum(clamped.values())
    if not (total > 1e-12):
        return None
    shares = {k: v / total for k, v in clamped.items()}

    # Annualized total vol from the SAME gross strip the shares come from —
    # internally consistent with the decomposition (unlike the published-NAV
    # fit vol, which is also absent entirely for synthetic composites, leaving
    # the F1 Active Risk Composition panel blank). Cadence inferred from the
    # median teo spacing so quarterly-filing series annualize correctly.
    periods_per_year = 12.0
    try:
        teos = [_dt.date.fromisoformat(str(t[0])[:10]) for t in layer_series]
        gaps = sorted(
            (teos[i + 1] - teos[i]).days for i in range(len(teos) - 1)
        )
        if gaps:
            med_gap = float(gaps[len(gaps) // 2])
            if med_gap > 0:
                periods_per_year = min(365.25 / med_gap, 252.0)
    except (ValueError, TypeError):
        pass
    shares["total_vol_ann"] = float((g_var ** 0.5) * (periods_per_year ** 0.5))
    # Pre-clamp shares so renderers can tell "clamped negative — the layer
    # moved against the book over this window" apart from a true zero.
    for k, v in raw.items():
        shares[f"{k}_raw"] = float(v)
    return shares


# ---------------------------------------------------------------------------
# FundData — the dataclass every F1/C1 renderer reads
# ---------------------------------------------------------------------------

@dataclass
class FundHolding:
    """A single position in the fund's most-recent holdings snapshot.

    The risk-share fields (``market_share``, ``sector_share``,
    ``subsector_share``, ``style_share``, ``residual_share``) are the
    per-stock ERM3 L3 explained-risk decomposition. They're shares of
    *that holding's* explained variance and must sum to ~1.0 when present.
    The F1 holdings chart uses them to colour each bar's segments — so a
    holding's bar shows both its weight (total length) and its risk
    composition (segment widths × weight = share of fund's variance).

    ``style_share`` is the FF2 (v4) SMB+HML slice split out of the L3
    residual; it's ``None`` on pre-v4 stocks, where ``residual_share``
    carries the full style+idio residual (4-leg fallback). On v4 stocks
    ``residual_share`` is the *true* idiosyncratic slice and
    ``style_share`` the style slice — matching the portfolio-level split
    (SDK/render-svc #262/#263).
    """

    symbol: str            # canonical bw_sym_id (e.g. "BW-FIGI-BBG000B9XRY4")
    ticker: str            # display ticker ("AAPL")
    company_name: str      # ("Apple Inc.")
    weight: float          # 0..1 portfolio weight
    sector_etf: str | None = None
    subsector_etf: str | None = None
    # Per-holding ERM3 risk decomposition (shares; sum to ~1.0)
    market_share: float | None = None
    sector_share: float | None = None
    subsector_share: float | None = None
    style_share: float | None = None      # FF2 SMB+HML slice; None pre-v4
    residual_share: float | None = None


@dataclass
class FundData:
    """All data needed to render any fund snapshot (F1 first; C1, F2 later).

    Identity / scope
    ----------------
    - ``bw_fund_id``      — canonical Funds_DAG id ("BW-FUND-S000004988")
    - ``ticker_primary``  — display ticker ("AGTHX")
    - ``fund_name``       — long name
    - ``teo``             — month-end as-of date
    - ``equity_style_9box`` — Morningstar-style category
    - ``aum_usd``         — total net assets in USD (raw)

    Performance time series — real only; empty when the per-fund zarr
    reader hasn't been wired or the fund has no NAV available.
    -----------------------------------------------------------------
    - ``cum_nav_return``      — list[(teo, cumulative_return)]
    - ``cum_bench_return``    — same shape, benchmark
    - ``tr_fund`` / ``tr_bench`` — trailing-return dicts ({"1y": …})
    - ``benchmark_label``

    Holdings
    --------
    - ``holdings``        — list[FundHolding], sorted desc by weight
    - ``n_holdings``      — total positions across the fund

    Risk decomposition (portfolio-aggregated ERM3 layers)
    -----------------------------------------------------
    Two views of the same data:

      ``portfolio_metrics``           — naive position-weighted ER
                                        (the L1/L2/L3/residual aggregate
                                        already in ``funds_latest.json``).
      ``portfolio_metrics_adjusted``  — correlation-adjusted ER from
                                        the SDK ``computeDiversification
                                        Metrics`` tool. Empty when the
                                        diversification API call has not
                                        been wired.
      ``diversification_credit``      — naive − adjusted, per layer.

    Hedge ratios
    ------------
    Position-weighted β to L1 (SPY) / L2 (sector ETF) / L3 (subsector
    ETF) orthogonal factors. Source: Funds_DAG ``ds_hr.zarr``. NOT a
    tradeable hedge notional (those require ETF covariance + inner
    diversification math; deferred until the SDK tool is plumbed).

    Peer cohort (style box)
    -----------------------
    - ``peer_cohort_label``, ``peer_cohort_size``, ``peer_rank_pct``,
      ``peer_summary``.

    Provenance
    ----------
    - ``sdk_version`` — for replay debugging.
    """

    # Identity
    bw_fund_id: str
    ticker_primary: str
    fund_name: str
    teo: str
    equity_style_9box: str | None
    aum_usd: float | None

    # Performance — cumulative series (empty = unavailable)
    cum_nav_return: list[tuple[str, float]] = field(default_factory=list)
    cum_bench_return: list[tuple[str, float]] = field(default_factory=list)
    tr_fund: dict[str, float | None] = field(default_factory=dict)
    tr_bench: dict[str, float | None] = field(default_factory=dict)
    benchmark_label: str = "Benchmark"

    # Holdings
    holdings: list[FundHolding] = field(default_factory=list)
    n_holdings: int = 0
    aggregate_active_share: float | None = None

    # Risk decomposition — naive vs adjusted
    portfolio_metrics: dict[str, Any] | None = None
    portfolio_metrics_adjusted: dict[str, Any] = field(default_factory=dict)
    # Naive top-N variance-share aggregation (kept for diagnostics).
    # When ``portfolio_metrics`` is populated from ds_portfolio.zarr's
    # adjusted_* attrs (preferred path), this carries the legacy naive
    # number for cross-comparison.
    portfolio_metrics_naive: dict[str, Any] | None = None
    # Trailing-12-month variance-share window (CFR-ortho, same shape as
    # ``portfolio_metrics``). Pairs with the 5Y/full-window view as a
    # side-by-side active-risk comparison in the F1 right panel.
    portfolio_metrics_recent: dict[str, Any] | None = None
    diversification_credit: dict[str, Any] = field(default_factory=dict)

    # Hedge ratios (position-weighted β; not tradeable notional)
    hedge_ratios: dict[str, float] = field(default_factory=dict)

    # Cascade-telescoping layer attribution shares (mkt / sec / sub / res),
    # summing to 1.0 — derived from prod(1+cumulative_layer_sum) over
    # the available periods. Each share is `(P_layer − P_prev) / PG`
    # where P_n are the cascade compound levels. Used by the Section I
    # waterfall: `share × gross_pct` gives the absolute pp contribution
    # that telescopes exactly to the line chart's cascade levels.
    # Empty when the underlying returns store has no populated periods.
    layer_attribution: dict[str, float] = field(default_factory=dict)

    # Per-period layer returns from ds_portfolio.zarr — the dense input to
    # the Section I waterfall's geometric telescoping math (same scheme
    # as ``P1Data.l3_er_series`` in the stock-side snapshot). Each tuple
    # is the FF2 (v4) 5-leg strip ``(teo_str, mkt, sec, sub, style, res)``.
    # Empty if ds_portfolio.zarr has no populated periods.
    layer_returns_series: list[tuple[str, float, float, float, float, float]] = field(default_factory=list)

    # Layered cumulative-return time series, derived from
    # layer_returns_series via the ERM3 sequential-compounding scheme
    # (see ENGINE_METHOD_NOTES §6) and rescaled to match NAV gross at
    # the endpoint. Each is list[(teo_str, cumulative_return)]. Used by
    # the Section I line chart so it can show Gross + L1 / L2 / L3 +
    # Residual α the same way stock_deep_dive does.
    cum_l1_market:    list[tuple[str, float]] = field(default_factory=list)
    cum_l2_sector:    list[tuple[str, float]] = field(default_factory=list)
    cum_l3_subsector: list[tuple[str, float]] = field(default_factory=list)
    # FF2 (v4) style leg — the SMB+HML increment over L3. Populated from the
    # (v4-split) ds_portfolio monthly cascade; empty when the daily cube
    # overrides the chart (that cube is pre-split — see cum_l3_residual).
    cum_style:        list[tuple[str, float]] = field(default_factory=list)
    cum_l3_residual:  list[tuple[str, float]] = field(default_factory=list)

    # Peer cohort
    peer_cohort_label: str | None = None
    peer_cohort_size: int | None = None
    peer_rank_pct: float | None = None
    peer_summary: dict[str, Any] = field(default_factory=dict)

    # ERM3 fit (from fund_fit_parquet — produced by Funds_DAG asset
    # `fund_fit_parquet`, joins ds_ph + ds_fund_returns_daily + ds_nav +
    # fund_master). Section III renders these directly. Empty when the
    # parquet is absent or this fund has no row.
    fit_coverage_mean:    float | None = None  # 0..1, mean over daily teos
    fit_coverage_latest:  float | None = None
    fit_correlation_monthly: float | None = None  # Pearson, ERM3 vs yfinance NAV
    fit_n_obs_monthly:    int | None = None
    fit_erm3_5y_return:   float | None = None    # daily-compound, last ~5y
    fit_nav_5y_return:    float | None = None    # monthly-compound, last 60 mths
    fit_delta_5y_pp:      float | None = None    # erm3 − nav, percentage points
    fit_expense_ratio:    float | None = None    # null until N-CEN populates fund_master

    # Vol-from-β decomposition (5y, monthly NAV regression on SPY)
    fit_nav_vol_5y:        float | None = None    # σ_NAV annualized
    fit_spy_vol_5y:        float | None = None    # σ_SPY annualized (constant)
    fit_nav_beta:          float | None = None    # β_NAV→SPY
    fit_nav_alpha:         float | None = None    # α annualized
    fit_nav_r2_capm:       float | None = None    # CAPM single-factor R²
    fit_capm_implied_vol:  float | None = None    # β × σ_SPY
    fit_residual_vol:      float | None = None    # √(σ_total² − σ_capm²) — vol NOT from β
    fit_erm3_multifactor_r2: float | None = None  # NAV monthly vs ERM3 (L1, L2, L3) — the
                                                  # "what ERM3 explains beyond β" pitch.

    # Russell 9-box ETF style classifier output (Funds_DAG.compute.fund_style_etf).
    # Populated by _ai_insight.enrich_with_ai_insight; absent on a bare
    # get_data_for_f1 call. Shape matches FundStyleETFFit.as_dict().
    style_etf_fit: dict[str, Any] | None = None

    # AI-synthesized editorial paragraph combining (a) style-box fit,
    # (b) ERM3 model fit, (c) subsector + residual perf, (d) ETF hedges.
    # When present, the F1 composer prefers this over the deterministic
    # fit_narrative lines. None = no synthesis run / API key missing.
    ai_insight_text: str | None = None

    # AI-synthesized institutional copy for the redesigned F1 layout.
    # Populated by ``_ai_insight.enrich_with_ai_insight``. Each is a
    # single string (already finalized prose) keyed by section.
    #   header_summary       — ONE sentence, top-of-page hero line
    #   section_ii_insight   — ONE sentence, above Top Holdings chart
    #   section_iii_narrative — 3–5 sentences, Section III intro block
    header_summary:        str | None = None
    benchmark_context:     str | None = None
    section_ii_insight:    str | None = None
    section_iii_narrative: str | None = None

    # Section III comparison-table content. Populated by
    # ``_ai_insight.enrich_section_iii_table``. Shape:
    #   {"rows": [{"metric": str, "agthx": str, "erm3": str, "etf": str,
    #     "emphasize": bool}], "etf_ticker": str}
    # When None the F1 composer falls back to the legacy fit-card layout.
    section_iii_table: dict[str, Any] | None = None

    sdk_version: str = "0.1.0"

    # SEC / sync metadata (Funds_DAG row). Used by temporal context in adapters.
    filing_date: str | None = None

    # Optional identity fields surfaced on cache JSON destined for adapters.
    fund_family: str | None = None
    share_class_count: int | None = None
    expense_ratio: float | None = None
    inception_date: str | None = None

    coverage_pct: float | None = None

    @property
    def symbol_id(self) -> str:
        return self.bw_fund_id

    @property
    def total_holdings_count(self) -> int:
        return self.n_holdings

    @property
    def aum_usd_billions(self) -> float | None:
        """AUM in $B, for header formatting."""
        return None if self.aum_usd is None else self.aum_usd / 1e9

    def to_json(self, path: str | Path) -> Path:
        from ._json_io import dump_json

        return dump_json(self, path)

    @classmethod
    def from_json(cls, path: str | Path) -> FundData:
        from ._json_io import load_json

        raw = load_json(path)
        d = raw["data"]
        if _fund_data_json_is_legacy(d):
            return _fund_data_legacy_cache_dict_to_cls(cls, d)
        return _fund_data_institutional_dict_to_cls(cls, d)


def _fund_data_json_is_legacy(d: dict[str, Any]) -> bool:
    if "cum_fund" in d:
        return True
    return bool(d.get("symbol_id")) and "cum_nav_return" not in d


def _fund_holding_from_plain(h: Any) -> FundHolding:
    if isinstance(h, FundHolding):
        return h
    if not isinstance(h, dict):
        raise TypeError(f"holding entry must be dict or FundHolding, got {type(h)!r}")
    return FundHolding(
        symbol=str(h.get("symbol", "")),
        ticker=str(h["ticker"]),
        company_name=str(h.get("company_name", h.get("name", h["ticker"]))),
        weight=float(h["weight"]),
        sector_etf=h.get("sector_etf"),
        subsector_etf=h.get("subsector_etf"),
        market_share=h.get("market_share"),
        sector_share=h.get("sector_share"),
        subsector_share=h.get("subsector_share"),
        style_share=h.get("style_share"),
        residual_share=h.get("residual_share"),
    )


def _load_series_pairs(lst: list | None) -> list[tuple[str, float]]:
    if not lst:
        return []
    out: list[tuple[str, float]] = []
    for r in lst:
        if r is None:
            continue
        if isinstance(r, (tuple, list)) and len(r) >= 2 and r[1] is not None:
            out.append((str(r[0]), float(r[1])))
    return out


def _fund_data_institutional_dict_to_cls(cls: type[FundData], d: dict[str, Any]) -> FundData:
    holds_raw = d.get("holdings") or []
    holdings = [_fund_holding_from_plain(h) for h in holds_raw]
    lr = d.get("layer_returns_series") or []
    layer_returns_series: list[tuple[str, float, float, float, float, float]] = []
    if lr and isinstance(lr[0], (list, tuple)):
        for t in lr:
            if len(t) >= 6:  # v4 5-leg tuple (teo, mkt, sec, sub, style, res)
                layer_returns_series.append(
                    (str(t[0]), float(t[1]), float(t[2]), float(t[3]),
                     float(t[4]), float(t[5]))
                )
            elif len(t) >= 5:  # legacy 4-leg (teo, mkt, sec, sub, res) — style=0
                layer_returns_series.append(
                    (str(t[0]), float(t[1]), float(t[2]), float(t[3]),
                     0.0, float(t[4]))
                )
    return cls(
        bw_fund_id=str(d.get("bw_fund_id", "")),
        ticker_primary=str(d["ticker_primary"]),
        fund_name=str(d["fund_name"]),
        teo=str(d["teo"]),
        equity_style_9box=d.get("equity_style_9box"),
        aum_usd=d.get("aum_usd"),
        cum_nav_return=_load_series_pairs(d.get("cum_nav_return")),
        cum_bench_return=_load_series_pairs(d.get("cum_bench_return")),
        tr_fund=dict(d.get("tr_fund", {})),
        tr_bench=dict(d.get("tr_bench", {})),
        benchmark_label=str(d.get("benchmark_label", "Benchmark")),
        holdings=holdings,
        n_holdings=int(d.get("n_holdings", 0)),
        aggregate_active_share=d.get("aggregate_active_share"),
        portfolio_metrics=d.get("portfolio_metrics"),
        portfolio_metrics_adjusted=dict(d.get("portfolio_metrics_adjusted", {})),
        portfolio_metrics_naive=d.get("portfolio_metrics_naive"),
        portfolio_metrics_recent=d.get("portfolio_metrics_recent"),
        diversification_credit=dict(d.get("diversification_credit", {})),
        hedge_ratios=dict(d.get("hedge_ratios", {})),
        layer_attribution=dict(d.get("layer_attribution", {})),
        layer_returns_series=layer_returns_series,
        cum_l1_market=_load_series_pairs(d.get("cum_l1_market")),
        cum_l2_sector=_load_series_pairs(d.get("cum_l2_sector")),
        cum_l3_subsector=_load_series_pairs(d.get("cum_l3_subsector")),
        cum_style=_load_series_pairs(d.get("cum_style")),
        cum_l3_residual=_load_series_pairs(d.get("cum_l3_residual")),
        peer_cohort_label=d.get("peer_cohort_label"),
        peer_cohort_size=d.get("peer_cohort_size"),
        peer_rank_pct=d.get("peer_rank_pct"),
        peer_summary=dict(d.get("peer_summary", {})),
        fit_coverage_mean=d.get("fit_coverage_mean"),
        fit_coverage_latest=d.get("fit_coverage_latest"),
        fit_correlation_monthly=d.get("fit_correlation_monthly"),
        fit_n_obs_monthly=d.get("fit_n_obs_monthly"),
        fit_erm3_5y_return=d.get("fit_erm3_5y_return"),
        fit_nav_5y_return=d.get("fit_nav_5y_return"),
        fit_delta_5y_pp=d.get("fit_delta_5y_pp"),
        fit_expense_ratio=d.get("fit_expense_ratio"),
        fit_nav_vol_5y=d.get("fit_nav_vol_5y"),
        fit_spy_vol_5y=d.get("fit_spy_vol_5y"),
        fit_nav_beta=d.get("fit_nav_beta"),
        fit_nav_alpha=d.get("fit_nav_alpha"),
        fit_nav_r2_capm=d.get("fit_nav_r2_capm"),
        fit_capm_implied_vol=d.get("fit_capm_implied_vol"),
        fit_residual_vol=d.get("fit_residual_vol"),
        fit_erm3_multifactor_r2=d.get("fit_erm3_multifactor_r2"),
        style_etf_fit=d.get("style_etf_fit"),
        ai_insight_text=d.get("ai_insight_text"),
        header_summary=d.get("header_summary"),
        benchmark_context=d.get("benchmark_context"),
        section_ii_insight=d.get("section_ii_insight"),
        section_iii_narrative=d.get("section_iii_narrative"),
        section_iii_table=d.get("section_iii_table"),
        sdk_version=str(d.get("sdk_version", "0.1.0")),
        filing_date=d.get("filing_date"),
        fund_family=d.get("fund_family"),
        share_class_count=d.get("share_class_count"),
        expense_ratio=d.get("expense_ratio"),
        inception_date=d.get("inception_date"),
        coverage_pct=d.get("coverage_pct"),
    )


def _fund_data_legacy_cache_dict_to_cls(cls: type[FundData], d: dict[str, Any]) -> FundData:
    def _lh(row: dict[str, Any]) -> FundHolding:
        sym = row.get("symbol") or row.get("ticker") or ""
        tk = row.get("ticker") or sym
        return FundHolding(
            symbol=str(sym),
            ticker=str(tk),
            company_name=str(row.get("company_name") or tk),
            weight=float(row.get("weight") or 0.0),
            sector_etf=row.get("sector_etf"),
            subsector_etf=row.get("subsector_etf"),
            market_share=row.get("market_share"),
            sector_share=row.get("sector_share"),
            subsector_share=row.get("subsector_share"),
            style_share=row.get("style_share"),
            residual_share=row.get("residual_share"),
        )

    holdings = [_lh(dict(h)) for h in (d.get("holdings") or [])]

    tf = dict(d.get("tr_fund", {}) or {})
    tb = dict(d.get("tr_spy", {}) or d.get("tr_bench", {}) or {})

    portfolio_metrics_any = dict(d.get("portfolio_metrics", {}) or {})
    return cls(
        bw_fund_id=str(d.get("symbol_id", d.get("bw_fund_id", ""))),
        ticker_primary=str(d.get("ticker_primary") or d.get("symbol_id") or "—"),
        fund_name=str(d.get("name", d.get("fund_name", ""))),
        teo=str(d.get("teo", "")),
        equity_style_9box=d.get("equity_style_9box"),
        aum_usd=d.get("aum_usd"),
        cum_nav_return=_load_series_pairs(d.get("cum_fund")),
        cum_bench_return=_load_series_pairs(d.get("cum_spy")),
        tr_fund=tf,
        tr_bench=tb,
        benchmark_label=str(d.get("benchmark_label", "Benchmark")),
        holdings=holdings,
        n_holdings=int(d.get("total_holdings_count", len(holdings))),
        portfolio_metrics=portfolio_metrics_any or None,
        peer_cohort_label=d.get("peer_cohort_label"),
        peer_rank_pct=d.get("peer_rank_pct"),
        diversification_credit=dict(d.get("diversification_credit", {})),
        header_summary=d.get("header_summary"),
        sdk_version=str(d.get("sdk_version", "0.3.0")),
        filing_date=d.get("filing_date"),
        fund_family=d.get("fund_family"),
        share_class_count=d.get("share_class_count"),
        expense_ratio=d.get("expense_ratio"),
        inception_date=d.get("inception_date"),
        coverage_pct=d.get("coverage_pct"),
    )


# ---------------------------------------------------------------------------
# Real-fixture loader — Funds_DAG/data/sync/funds/funds_latest.json
# ---------------------------------------------------------------------------

def _funds_latest_path() -> Path:
    """Default path to the canonical funds_latest.json fixture.

    Override via ``FUNDS_DAG_DATA_ROOT`` env var.
    """
    import os
    env = os.environ.get("FUNDS_DAG_DATA_ROOT")
    if env:
        return Path(env) / "sync" / "funds" / "funds_latest.json"
    api_repo = Path(__file__).resolve().parents[3]
    return api_repo.parent / "Funds_DAG" / "data" / "sync" / "funds" / "funds_latest.json"


def from_fixture_row(row: dict[str, Any]) -> FundData:
    """Build a ``FundData`` from one row of ``funds_latest.json``.

    Per-fund time series (NAV) and holdings detail are NOT in this
    fixture — they come from the per-fund zarr (``ds_nav.zarr`` /
    ``ds_ph.zarr``) and the SDK diversification call. Until those are
    wired, the time-series + holdings + adjusted-metrics fields stay
    empty and the renderer shows explicit "data unavailable" placeholders.
    """
    md = row.get("metadata") or {}
    pm_naive = {
        "l1_market_er":    float(row.get("portfolio_market_return")     or 0.0),
        "l2_sector_er":    float(row.get("portfolio_sector_return")     or 0.0),
        "l3_subsector_er": float(row.get("portfolio_subsector_return")  or 0.0),
        # FF2 (v4) style leg — present in the fixture row for v4 funds; 0 when
        # absent (pre-v4). Kept alongside the idio-net-of-style residual.
        "style_er":        float(row.get("portfolio_style_return")      or 0.0),
        "l3_residual_er":  float(row.get("portfolio_idiosyncratic_return") or 0.0),
    }
    return FundData(
        bw_fund_id=row.get("bw_fund_id", ""),
        ticker_primary=md.get("ticker_primary") or md.get("ticker") or "—",
        fund_name=md.get("fund_name") or row.get("bw_fund_id", ""),
        teo=row.get("report_date", ""),
        filing_date=row.get("filing_date"),
        equity_style_9box=row.get("equity_style_9box"),
        aum_usd=row.get("aum_erm3"),
        # Time series + holdings + hedge ratios + diversification-adjusted
        # metrics deliberately empty: the funds_latest.json fixture is a
        # portfolio-state snapshot, not a time-series store, and the
        # diversification API hasn't been wired yet. Renderer handles
        # emptiness.
        portfolio_metrics=pm_naive,
        n_holdings=int(row.get("n_holdings_active") or 0),
        peer_cohort_label=row.get("equity_style_9box"),
        peer_cohort_size=row.get("n_funds_in_cell_at_report_date"),
    )


def load_fund_from_fixture(
    bw_fund_id: str,
    *,
    fixture_path: Path | str | None = None,
) -> FundData:
    """Read ``funds_latest.json``, find ``bw_fund_id``, return a FundData.

    Production-grade real-data path for parts the fixture covers.
    Time series, holdings detail, hedge ratios, and diversification-
    adjusted metrics remain empty until their respective fetchers ship
    (per-fund zarr reader + ``computeDiversificationMetrics`` integration).
    """
    import json
    p = Path(fixture_path) if fixture_path else _funds_latest_path()
    with open(p) as f:
        rows = json.load(f)
    for row in rows:
        if row.get("bw_fund_id") == bw_fund_id:
            return from_fixture_row(row)
    raise KeyError(f"bw_fund_id={bw_fund_id!r} not found in {p}")


# ---------------------------------------------------------------------------
# Zarr-direct fetcher — bypasses the broken composer API for funds whose
# per-fund zarrs hold real data but whose snapshot/holdings/nav routes
# return zeros or "1970-01-01" placeholders. Path is fixed in the GCS
# bucket via the same prefix the TS DAL uses (rm_api_data/ERM3_Funds).
# ---------------------------------------------------------------------------

ZARR_FUNDS_GCS_PREFIX = "rm_api_data/ERM3_Funds"


def _decode_teo_array(teo_arr: Any) -> "Any":  # numpy ndarray
    """Decode a zarr ``teo`` array into a ``datetime64[D]`` numpy array.

    Per-fund zarr stores written by Funds_DAG over time settled on three
    different ``teo`` encodings, and the four read sites in this module
    historically each decoded inline with subtly different logic:

      1. **CF int days** — ``units = "days since YYYY-MM-DD"`` on the array
         attrs. Post-2026-05 xarray-aware writers (e.g. ds_ph rewritten by
         the holdings pipeline) emit this.
      2. **CF int seconds** — ``units = "seconds since YYYY-MM-DD"`` (rare;
         covered defensively).
      3. **Legacy int seconds-since-Unix-epoch** — older writers (notably
         ds_portfolio) wrote a plain int64 without a ``units`` attr; the
         caller decoded by passing dtype ``datetime64[s]`` to numpy.
      4. **Native datetime64** — ds_nav historically wrote already-decoded
         datetime64 values; the caller naively ``str(t)``-stringified them.
         If a writer started emitting CF int days here, the naive stringify
         silently produced raw integers ("12345") instead of dates, and
         those rotted forward as if they were dates — a P.7 / silent date
         misalignment bug.

    This helper centralizes the decoding decision so all four stores
    produce the same ``datetime64[D]`` output regardless of which writer
    flavor is on disk. Returns a numpy ``datetime64[D]`` array shaped
    like the input.
    """
    import numpy as np

    raw = teo_arr[:]

    # Native datetime64 already on disk → cast to day precision.
    if hasattr(raw, "dtype") and raw.dtype.kind == "M":
        return raw.astype("datetime64[D]")

    units = ""
    try:
        units = dict(teo_arr.attrs).get("units", "")
    except (AttributeError, TypeError):
        pass

    if units.startswith("days since "):
        epoch_str = units.removeprefix("days since ").split(" ")[0]
        epoch = np.datetime64(epoch_str)
        return (epoch + raw.astype("timedelta64[D]")).astype("datetime64[D]")

    if units.startswith("seconds since "):
        epoch_str = units.removeprefix("seconds since ").split(" ")[0]
        epoch = np.datetime64(epoch_str)
        return (epoch + raw.astype("timedelta64[s]")).astype("datetime64[D]")

    # Legacy default: integer seconds-since-Unix-epoch. ds_portfolio.zarr
    # writers used this convention without setting a units attr.
    return np.asarray(raw, dtype="datetime64[s]").astype("datetime64[D]")


def _local_fund_zarr_root() -> Path | None:
    """Resolve local per-fund zarr parent (contains ``bw_fund_id/``).

    Priority: ``FUNDS_DAG_ZARR_ROOT`` (explicit zarr dir), then
    ``FUNDS_DAG_DATA_ROOT/sec_data/zarr`` (canonical external data root).
    """
    import os

    zarr_root = os.environ.get("FUNDS_DAG_ZARR_ROOT", "").strip()
    if zarr_root:
        return Path(zarr_root).expanduser().resolve()
    data_root = os.environ.get("FUNDS_DAG_DATA_ROOT", "").strip()
    if data_root:
        return Path(data_root).expanduser().resolve() / "sec_data" / "zarr"
    return None


def _open_fund_zarr(bw_fund_id: str, store: str):
    """Return an open zarr group for one of the per-fund stores.

    ``store`` is one of: ``ds_nav.zarr``, ``ds_ph.zarr``, ``ds_hr.zarr``,
    ``ds_portfolio.zarr``, ``ds_fund_returns_daily.zarr``.

    Reads local zarr under :func:`_local_fund_zarr_root` when present
    (post-Dagster laptop rebuilds); otherwise GCS
    ``gs://rm_api_data/ERM3_Funds/bw_fund_id/...``.

    Raises :exc:`FileNotFoundError` when the store is missing or not a zarr
    group (callers treat that as soft-fail).

    ``zarr.open`` raises :class:`zarr.errors.PathNotFoundError` (e.g. message
    ``nothing found at path ''``) for missing GCS prefixes — not
    :exc:`FileNotFoundError`, so we normalize here.
    """
    import gcsfs
    import zarr
    from zarr.errors import ArrayNotFoundError, GroupNotFoundError, PathNotFoundError

    local_root = _local_fund_zarr_root()
    if local_root is not None:
        local_path = local_root / "bw_fund_id" / bw_fund_id / store
        if local_path.is_dir():
            try:
                return zarr.open(str(local_path), mode="r")
            except (GroupNotFoundError, PathNotFoundError, ArrayNotFoundError, KeyError) as e:
                raise FileNotFoundError(str(local_path)) from e

    fs = gcsfs.GCSFileSystem()
    path = f"gs://{ZARR_FUNDS_GCS_PREFIX}/bw_fund_id/{bw_fund_id}/{store}"
    try:
        return zarr.open(fs.get_mapper(path), mode="r")
    except (GroupNotFoundError, PathNotFoundError, ArrayNotFoundError, KeyError) as e:
        raise FileNotFoundError(path) from e


def _fund_identity(bw_fund_id: str) -> dict[str, Any]:
    """Read identity (ticker, fund_name, equity_style_9box, latest_*) for a fund.

    Tries two sources in priority order:

    1. **Local ``funds.json``** under the path resolved by
       :func:`_funds_latest_path` (sibling Funds_DAG clone, or
       ``FUNDS_DAG_DATA_ROOT`` if set). This is the canonical source
       on a laptop where the Funds_DAG clone is checked out next to
       this repo.
    2. **Supabase ``public.funds``** (fallback). Used when the local
       file isn't present — the production Cloud Run case where the
       SDK is installed under ``site-packages`` and the sibling path
       doesn't exist, but Supabase credentials ARE wired.

    Returns ``{}`` if neither source has the fund. This is the
    structural half of MASTER_BACKLOG P.2 / O.9 (the operational
    half — wiring ``FUNDS_DAG_DATA_ROOT`` on Cloud Run — stays
    operator-side and is independent of this fix).
    """
    import json
    p = _funds_latest_path().parent / "funds.json"
    if p.exists():
        rows = json.loads(p.read_text())
        for row in rows:
            if row.get("bw_fund_id") == bw_fund_id:
                return row
    # Local funds.json unavailable (Cloud Run case) — try Supabase.
    return _fund_identity_from_supabase(bw_fund_id)


# ---------------------------------------------------------------------------
# Supabase enrichment — moved from BWMACRO/src/bwmacro/snapshots/funds/_data.py
# so the public SDK's get_data_for_f1 returns real tickers / fund identity by
# default. Previously the enricher lived only in the BWMACRO renderer wrapper,
# so render-svc (which calls the public SDK directly) bypassed it entirely
# and rendered raw FIGI/symbol IDs (MASTER_BACKLOG P.1). All Supabase reads
# soft-fail to an empty result when credentials are missing — pip consumers
# without keys still work, the holdings just don't get enriched.
# ---------------------------------------------------------------------------


def _supabase_creds() -> tuple[str, str] | None:
    """Resolve Supabase URL + key from env. Returns ``None`` when missing.

    Checks both the server-style (``SUPABASE_URL`` + ``SUPABASE_SERVICE_ROLE_KEY``)
    and Next.js-frontend-style (``NEXT_PUBLIC_SUPABASE_URL`` +
    ``NEXT_PUBLIC_SUPABASE_ANON_KEY``) conventions so callers don't have to
    care which one is wired in any given env.
    """
    import os
    url = (
        os.environ.get("SUPABASE_URL")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
        or ""
    ).strip().strip('"').strip("'").rstrip("/")
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
        or ""
    ).strip().strip('"').strip("'")
    if not url or not key:
        return None
    return url, key


def _supabase_query(path: str, params: dict[str, str]) -> list[dict[str, Any]]:
    """GET ``{SUPABASE_URL}/rest/v1/{path}?{params}`` and return rows.

    Soft-fails (returns ``[]``) when credentials are missing or the request
    raises — render-svc and pip consumers without keys behave as if the
    enrichment didn't happen rather than crashing.
    """
    creds = _supabase_creds()
    if creds is None:
        return []
    url, key = creds
    try:
        import httpx
        r = httpx.get(
            f"{url}/rest/v1/{path}",
            params=params,
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=15,
        )
        r.raise_for_status()
        rows = r.json()
        return rows if isinstance(rows, list) else []
    except Exception:
        return []


def _fund_identity_from_supabase(bw_fund_id: str) -> dict[str, Any]:
    """Query ``public.funds`` for the fund identity row.

    Returns the same shape ``funds.json`` rows would have — ``ticker``,
    ``fund_name``, ``equity_style_9box``, ``latest_report_date``,
    ``latest_total_adj_mv`` — so callers can treat both sources
    interchangeably. ``{}`` when not found.
    """
    rows = _supabase_query(
        "funds",
        {
            "bw_fund_id": f"eq.{bw_fund_id}",
            "select": (
                "bw_fund_id,ticker,fund_name,equity_style_9box,"
                "latest_report_date,latest_total_adj_mv"
            ),
            "limit": "1",
        },
    )
    return rows[0] if rows else {}


def _resolve_holdings_metadata(symbols: list[str]) -> dict[str, dict[str, Any]]:
    """Resolve ``symbol → {ticker, name, sector_etf, subsector_etf}``."""
    if not symbols:
        return {}
    in_clause = "(" + ",".join(symbols) + ")"
    rows = _supabase_query(
        "symbols",
        {"symbol": f"in.{in_clause}", "select": "symbol,ticker,name,sector_etf,subsector_etf"},
    )
    return {r["symbol"]: r for r in rows}


def _resolve_l3_decomposition(symbols: list[str]) -> dict[str, dict[str, float | None]]:
    """Resolve ``symbol → ERM3 L3 explained-variance share dict``."""
    if not symbols:
        return {}
    in_clause = "(" + ",".join(symbols) + ")"
    base_cols = "symbol,l3_mkt_er,l3_sec_er,l3_sub_er,l3_res_er"
    # FF2 (v4) split columns. Try them first; _supabase_query soft-fails an
    # unknown-column 400 to [] (pre-migration), so an empty result triggers the
    # base 4-leg retry. This keeps the reader deployable ahead of the migration.
    rows = _supabase_query(
        "security_history_latest",
        {
            "symbol": f"in.{in_clause}",
            "periodicity": "eq.daily",
            "select": base_cols + ",l3_style_er,l3_stock_specific_er",
        },
    )
    if not rows:
        rows = _supabase_query(
            "security_history_latest",
            {
                "symbol": f"in.{in_clause}",
                "periodicity": "eq.daily",
                "select": base_cols,
            },
        )

    out: dict[str, dict[str, float]] = {}
    for r in rows:
        style = r.get("l3_style_er")
        idio = r.get("l3_stock_specific_er")
        base = {
            "market_share": float(r["l3_mkt_er"] or 0.0),
            "sector_share": float(r["l3_sec_er"] or 0.0),
            "subsector_share": float(r["l3_sub_er"] or 0.0),
        }
        if style is not None and idio is not None:
            # v4: L3 residual splits into style (SMB+HML) + true idio. The
            # identity l3_res_er = l3_style_er + l3_stock_specific_er holds, so
            # residual_share here is the *true* idio slice, not the full residual.
            out[r["symbol"]] = {
                **base,
                "style_share": float(style or 0.0),
                "residual_share": float(idio or 0.0),
            }
        else:
            # pre-v4 stock: 4-leg, residual carries the full style+idio residual.
            out[r["symbol"]] = {
                **base,
                "style_share": None,
                "residual_share": float(r["l3_res_er"] or 0.0),
            }
    return out


def _share_or_fallback(
    shares: dict[str, float],
    key: str,
    fallback: float | None,
) -> float | None:
    if not shares:
        return fallback
    v = shares.get(key)
    return fallback if v is None else float(v)


def enrich_fund_data_with_supabase(fd: FundData) -> FundData:
    """Resolve tickers / sector ETFs / per-stock L3 shares for holdings.

    The public SDK's ``get_data_for_f1`` calls this by default so renders
    show real tickers (``AAPL``) instead of raw symbol/FIGI IDs
    (``BW-FIGI-BBG000B9XRY4``). Soft-fails to an unchanged ``FundData``
    when Supabase credentials are not wired (pip consumers; CI tests
    without env access) — never raises.

    Returns the input unchanged when holdings are empty.
    """
    if not fd.holdings:
        return fd

    syms = [h.symbol for h in fd.holdings]
    ticker_map = _resolve_holdings_metadata(syms)
    l3_map = _resolve_l3_decomposition(syms)
    new_holdings: list[FundHolding] = []
    for h in fd.holdings:
        meta = ticker_map.get(h.symbol, {})
        shares = l3_map.get(h.symbol, {})
        new_holdings.append(
            FundHolding(
                symbol=h.symbol,
                ticker=meta.get("ticker") or h.ticker,
                company_name=(
                    meta.get("name") or meta.get("ticker") or h.company_name
                ),
                weight=h.weight,
                sector_etf=meta.get("sector_etf") or h.sector_etf,
                subsector_etf=meta.get("subsector_etf") or h.subsector_etf,
                market_share=_share_or_fallback(
                    shares, "market_share", h.market_share),
                sector_share=_share_or_fallback(
                    shares, "sector_share", h.sector_share),
                subsector_share=_share_or_fallback(
                    shares, "subsector_share", h.subsector_share),
                style_share=_share_or_fallback(
                    shares, "style_share", h.style_share),
                residual_share=_share_or_fallback(
                    shares, "residual_share", h.residual_share),
            )
        )
    return replace(fd, holdings=new_holdings)


def get_data_for_f1(
    bw_fund_id: str,
    *,
    client: Any | None = None,           # kept for API back-compat; unused
    benchmark_ticker: str = "SPY",        # ditto — benchmark wiring deferred
    top_n_holdings: int = 10,
    nav_lookback_months: int = 60,
    enrich: bool = True,
) -> FundData:
    """Populate ``FundData`` directly from the per-fund GCS zarrs.

    Reads four zarr stores under ``gs://rm_api_data/ERM3_Funds/bw_fund_id/
    {bw_fund_id}/``:

      - ``ds_nav.zarr`` → cumulative NAV from monthly returns
      - ``ds_ph.zarr``  → top-N holdings at the latest valid AUM period
      - ``ds_hr.zarr``  → L1/L2/L3 hedge ratios at the latest period
      - ``ds_portfolio.zarr`` → portfolio risk metrics at the latest non-zero period

    Symbols resolve to tickers via Supabase ``symbols``; per-stock L3 ER
    shares come from ``security_history_latest``. Identity (ticker /
    fund_name / equity_style) comes from the local Funds_DAG funds.json
    sibling clone.

    Why direct zarr reads: the composer endpoints (/api/funds/snapshot
    and friends) currently return ``aum_erm3=null``, ``weight=null``, and
    ``"No NAV history available"`` for funds whose portfolio metrics are
    stubbed in funds_latest.json — even when the underlying zarrs are
    fully populated. The API gap is real; the zarrs are not.

    Per the no-mock-data rule: every value here is a real read; missing
    fields fall through as empty for the renderer's placeholder path.
    """
    import numpy as np

    identity = _fund_identity(bw_fund_id)
    ticker_primary = identity.get("ticker") or "—"
    fund_name = identity.get("fund_name") or bw_fund_id
    equity_style = identity.get("equity_style_9box")

    # ── Holdings (ds_ph.zarr) — pick latest period with finite AUM ──────
    holdings_list: list[FundHolding] = []
    n_holdings_total = 0
    aum_usd: float | None = identity.get("latest_total_adj_mv")
    teo_str: str = identity.get("latest_report_date") or ""
    try:
        ph = _open_fund_zarr(bw_fund_id, "ds_ph.zarr")
        ph_aum = ph["aum_erm3"][:]
        valid = np.where(np.isfinite(ph_aum) & (ph_aum > 0))[0]
        if len(valid):
            idx = int(valid.max())
            adj_mv = ph["adj_mv"][:, idx]
            sym_arr = ph["symbol"][:]
            mask = np.isfinite(adj_mv) & (adj_mv > 0)
            sym_real = sym_arr[mask]
            mv_real = adj_mv[mask]
            n_holdings_total = int(mask.sum())
            aum_usd = float(ph_aum[idx])
            if "teo" in ph.array_keys():
                teo_decoded = _decode_teo_array(ph["teo"])
                teo_str = str(teo_decoded[idx])
            order = np.argsort(-mv_real)[:top_n_holdings]
            top_syms = [str(sym_real[i]) for i in order]
            ticker_map = {s: {} for s in top_syms}
            l3_map: dict[str, dict[str, float]] = {}
            for i in order:
                sym = str(sym_real[i])
                meta = ticker_map.get(sym, {})
                shares = l3_map.get(sym, {})
                weight = float(mv_real[i] / aum_usd) if aum_usd else 0.0
                holdings_list.append(FundHolding(
                    symbol=sym,
                    ticker=meta.get("ticker") or sym,
                    company_name=meta.get("name") or meta.get("ticker") or sym,
                    weight=weight,
                    sector_etf=meta.get("sector_etf"),
                    subsector_etf=meta.get("subsector_etf"),
                    market_share=shares.get("market_share"),
                    sector_share=shares.get("sector_share"),
                    subsector_share=shares.get("subsector_share"),
                    style_share=shares.get("style_share"),
                    residual_share=shares.get("residual_share"),
                ))
    except FileNotFoundError:
        pass

    # ── NAV (ds_nav.zarr) — full series, anchored later ─────────────────
    nav_teo_all: list[str] = []
    nav_ret_all: list[float] = []
    tr_fund: dict[str, float | None] = {}
    try:
        nv = _open_fund_zarr(bw_fund_id, "ds_nav.zarr")
        nav_teo_decoded = _decode_teo_array(nv["teo"])
        nav_ret = nv["nav_return_monthly"][:]
        finite = np.isfinite(nav_ret)
        nav_teo_all = [str(t) for t in nav_teo_decoded[finite]]
        nav_ret_all = nav_ret[finite].tolist()
        if len(nav_ret_all) >= 12:
            ttm_window = np.array(nav_ret_all[-12:])
            tr_fund["1y"] = float(np.prod(1.0 + ttm_window) - 1.0)
    except FileNotFoundError:
        pass

    # Build cum_nav over whichever window we have. Default = last
    # nav_lookback_months. If layer_series exists, expand to its start
    # date so Section I's Gross line and L*/Residual lines share an
    # anchor (the user expects the line chart and waterfall to read as
    # one decomposed story).
    cum_nav: list[tuple[str, float]] = []
    if nav_ret_all:
        start_idx = max(0, len(nav_ret_all) - nav_lookback_months)
        cum = 1.0
        for d, r in zip(nav_teo_all[start_idx:], nav_ret_all[start_idx:]):
            cum *= 1.0 + r
            cum_nav.append((d, cum - 1.0))


    # ── Hedge ratios (ds_hr.zarr) — latest period, top |β| per layer ────
    # Soft-fail per layer when its array is missing — some funds have
    # partial ds_hr.zarr (e.g., ContraFund only has L2_HR). Each layer
    # is independent; missing one shouldn't kill the whole render.
    hr_out: dict[str, float] = {}
    try:
        hr = _open_fund_zarr(bw_fund_id, "ds_hr.zarr")
        hr_keys = list(hr.array_keys()) if hasattr(hr, "array_keys") else []
        hr_sym = hr["symbol"][:] if "symbol" in hr_keys else None

        def _top_beta(arr, prefer: str | None = None) -> tuple[str, float] | None:
            if hr_sym is None:
                return None
            mask = np.isfinite(arr)
            if not mask.any():
                return None
            if prefer is not None and prefer in list(hr_sym):
                pi = list(hr_sym).index(prefer)
                if mask[pi]:
                    return prefer, float(arr[pi])
            i = int(np.argmax(np.abs(np.where(mask, arr, 0.0))))
            return str(hr_sym[i]), float(arr[i])

        if "L1_HR" in hr_keys and hr_sym is not None:
            l1 = _top_beta(hr["L1_HR"][-1, :], prefer="SPY")
            if l1:
                hr_out[f"l1_{l1[0].lower()}"] = l1[1]
        if "L2_HR" in hr_keys and hr_sym is not None:
            L2 = hr["L2_HR"][-1, :]
            l2 = _top_beta(np.where(np.array([s == "SPY" for s in hr_sym]), np.nan, L2))
            if l2:
                hr_out[f"l2_{l2[0].lower()}"] = l2[1]
        if "L3_HR" in hr_keys and hr_sym is not None:
            L3 = hr["L3_HR"][-1, :]
            l3 = _top_beta(np.where(np.array([s == "SPY" for s in hr_sym]), np.nan, L3))
            if l3:
                hr_out[f"l3_{l3[0].lower()}"] = l3[1]
    except FileNotFoundError:
        pass

    # ── Layer attribution from ds_portfolio.zarr — cascade-telescoping
    # cumulative contributions over the populated periods, expressed as
    # fractions of compound gross summing to 1.0. Consumers multiply by
    # the NAV-chart's compound gross endpoint to recover absolute pp
    # values that telescope exactly to gross:
    #   share[layer] * gross_pct == cascade pp contribution.
    #
    # Cascade math (over the populated months, sparse-month-safe):
    #   P1 = prod(1+mkt) - 1                         (market alone)
    #   P2 = prod(1+mkt+sec) - 1                     (+ sector)
    #   P3 = prod(1+mkt+sec+sub) - 1                 (+ subsector)
    #   PG = prod(1+mkt+sec+sub+res) - 1             (full gross)
    #   share = (P1, P2-P1, P3-P2, PG-P3) / PG
    #
    # Note: signs are preserved. For benchmark-aware large-cap funds
    # the L1 cascade can exceed gross while L2/L3 contributions are
    # negative — the share dict reflects this honestly (market > 1.0,
    # sector/subsector < 0) so the rendered bars float above and below
    # the gross line as expected.
    layer_attr: dict[str, float] = {}
    layer_series: list[tuple[str, float, float, float, float]] = []
    adj_variance_shares: dict[str, float] = {}
    adj_variance_shares_recent: dict[str, float] = {}
    try:
        pt = _open_fund_zarr(bw_fund_id, "ds_portfolio.zarr")
        ws = pt["weight_sum"][:]
        nz = np.where(ws > 0)[0]
        if len(nz):
            mkt_arr = pt["portfolio_market_return"][:]
            sec_arr = pt["portfolio_sector_return"][:]
            sub_arr = pt["portfolio_subsector_return"][:]
            # FF2 (v4) style leg (SMB+HML). Present on v4-cascade stores; older
            # stores predate the split → treat as 0 so the 5-leg identity
            # gross = mkt+sec+sub+style+idio reduces to the old 4-leg cleanly.
            if "portfolio_style_return" in pt:
                style_arr = pt["portfolio_style_return"][:]
            else:
                style_arr = np.zeros_like(mkt_arr)
            res_arr = pt["portfolio_idiosyncratic_return"][:]
            teo_decoded = _decode_teo_array(pt["teo"])
            for i in nz:
                d = str(teo_decoded[i])
                layer_series.append((
                    d,
                    float(mkt_arr[i]),
                    float(sec_arr[i]),
                    float(sub_arr[i]),
                    float(style_arr[i]),
                    float(res_arr[i]),
                ))
            mkt_nz = mkt_arr[nz]
            sec_nz = sec_arr[nz]
            sub_nz = sub_arr[nz]
            style_nz = style_arr[nz]
            res_nz = res_arr[nz]
            P1 = float(np.prod(1.0 + mkt_nz) - 1.0)
            P2 = float(np.prod(1.0 + mkt_nz + sec_nz) - 1.0)
            P3 = float(np.prod(1.0 + mkt_nz + sec_nz + sub_nz) - 1.0)
            PS = float(np.prod(1.0 + mkt_nz + sec_nz + sub_nz + style_nz) - 1.0)
            PG = float(
                np.prod(1.0 + mkt_nz + sec_nz + sub_nz + style_nz + res_nz) - 1.0
            )
            if abs(PG) > 1e-12:
                layer_attr = {
                    "market":    P1            / PG,
                    "sector":    (P2 - P1)     / PG,
                    "subsector": (P3 - P2)     / PG,
                    "style":     (PS - P3)     / PG,
                    "residual":  (PG - PS)     / PG,
                }
        # Strict CFR-ortho variance shares written by Funds_DAG
        # `aggregate_fund_portfolio` as zarr attrs. Two windows: the
        # full-history shares (used as primary) and a trailing-12m
        # "recent" set for the F1 side-by-side comparison. The v4 cascade adds
        # `adjusted_style_er`; absent on pre-v4 stores (share omitted → ~0).
        for k_out, k_in in [
            ("market",    "adjusted_l1_market_er"),
            ("sector",    "adjusted_l2_sector_er"),
            ("subsector", "adjusted_l3_subsector_er"),
            ("style",     "adjusted_style_er"),
            ("residual",  "adjusted_l3_residual_er"),
            ("total_vol_ann", "adjusted_total_vol_ann"),
        ]:
            if k_in in pt.attrs:
                adj_variance_shares[k_out] = float(pt.attrs[k_in])
        for k_out, k_in in [
            ("market",    "adjusted_recent_l1_market_er"),
            ("sector",    "adjusted_recent_l2_sector_er"),
            ("subsector", "adjusted_recent_l3_subsector_er"),
            ("style",     "adjusted_recent_style_er"),
            ("residual",  "adjusted_recent_l3_residual_er"),
            ("total_vol_ann", "adjusted_recent_total_vol_ann"),
        ]:
            if k_in in pt.attrs:
                adj_variance_shares_recent[k_out] = float(pt.attrs[k_in])
    except FileNotFoundError:
        pass

    # ── teo_str fallback chain ──────────────────────────────────────────
    # If ds_ph.zarr was the only source of teo_str and it was missing,
    # thin (no valid AUM periods), or lacked the teo array, teo_str is
    # still "" — and render-svc rejects the request with
    # "no resolved as_of". Fall back to ds_nav's last monthly NAV teo,
    # then ds_portfolio's last populated quarter, in priority order.
    # Both fallback sources are pre-decoded to YYYY-MM-DD strings by the
    # blocks above, so we can use them directly.
    if not teo_str and nav_teo_all:
        teo_str = nav_teo_all[-1]
    if not teo_str and layer_series:
        teo_str = layer_series[-1][0]

    # If layer-returns series exists, expand cum_nav back to the layer
    # start so the gross line and the L*/Residual lines share a common
    # anchor at 0% — CAPPED at nav_lookback_months. Real funds' N-PORT
    # strips start ~2021 so the cap is a no-op, but synthetic composites
    # carry decades of layer history and the uncapped expansion turned the
    # "5-Year" section into a 20-year compounding chart (unreadable, and
    # the section title lied). The FULL layer_series still drives the
    # realized variance shares below — only the chart/waterfall window is
    # capped here. (The daily-returns path below already windows in days.)
    layer_series_chart = (
        layer_series[-nav_lookback_months:] if layer_series else layer_series
    )
    if layer_series_chart and nav_ret_all:
        first_d = layer_series_chart[0][0]
        last_d  = layer_series_chart[-1][0]
        # Find first NAV index >= first_d.
        start_i = next(
            (i for i, t in enumerate(nav_teo_all) if t >= first_d),
            None,
        )
        end_i = next(
            (i for i in range(len(nav_teo_all) - 1, -1, -1)
             if nav_teo_all[i] <= last_d),
            None,
        )
        if start_i is not None and end_i is not None and end_i >= start_i + 1:
            cum_nav = []
            cum = 1.0
            for d, r in zip(nav_teo_all[start_i:end_i + 1],
                            nav_ret_all[start_i:end_i + 1]):
                cum *= 1.0 + r
                cum_nav.append((d, cum - 1.0))
            # Re-anchor to start at 0%.
            if cum_nav:
                anchor = cum_nav[0][1]
                cum_nav = [
                    (d, (1.0 + v) / (1.0 + anchor) - 1.0)
                    for d, v in cum_nav
                ]

    # ── Layered cumulative series (L1 / L2 / L3 / Residual) ──────────
    # Sequential-compounding through the ERM3 hierarchy, evaluated at
    # each period in layer_returns_series. Then rescaled so the gross
    # endpoint equals the NAV chart's gross — same trick the waterfall
    # uses, applied per-point so the lines reconcile with NAV at the
    # end while preserving the layer mix from the geometric scheme.
    cum_l1: list[tuple[str, float]] = []
    cum_l2: list[tuple[str, float]] = []
    cum_l3: list[tuple[str, float]] = []
    cum_style: list[tuple[str, float]] = []
    cum_res: list[tuple[str, float]] = []
    if layer_series_chart:
        # Anchor at 0% (matches stock_deep_dive's series_with_zero_start).
        anchor_d = cum_nav[0][0] if cum_nav else layer_series_chart[0][0]
        cum_l1.append((anchor_d, 0.0))
        cum_l2.append((anchor_d, 0.0))
        cum_l3.append((anchor_d, 0.0))
        cum_style.append((anchor_d, 0.0))
        cum_res.append((anchor_d, 0.0))
        prod_l1 = prod_l2 = prod_l3 = prod_style = prod_g = 1.0
        for d, mkt, sec, sub, style, res in layer_series_chart:
            prod_l1    *= 1.0 + mkt
            prod_l2    *= 1.0 + mkt + sec
            prod_l3    *= 1.0 + mkt + sec + sub
            prod_style *= 1.0 + mkt + sec + sub + style
            prod_g     *= 1.0 + mkt + sec + sub + style + res
            cum_l1.append((d, prod_l1 - 1.0))
            cum_l2.append((d, prod_l2 - 1.0))
            cum_l3.append((d, prod_l3 - 1.0))
            cum_style.append((d, prod_style - prod_l3))
            cum_res.append((d, prod_g - prod_style))
        # Scale L*/Style/Residual so gross endpoint == NAV gross endpoint.
        gross_geom = prod_g - 1.0
        nav_gross = cum_nav[-1][1] if cum_nav else gross_geom
        if gross_geom != 0 and nav_gross != 0:
            scale = nav_gross / gross_geom
            cum_l1    = [(d, v * scale) for d, v in cum_l1]
            cum_l2    = [(d, v * scale) for d, v in cum_l2]
            cum_l3    = [(d, v * scale) for d, v in cum_l3]
            cum_style = [(d, v * scale) for d, v in cum_style]
            cum_res   = [(d, v * scale) for d, v in cum_res]
        # Recompute layer_attribution over the SAME chart window. The
        # earlier full-history ratios are wrong once the chart is capped:
        # the waterfall multiplies these ratios by the chart's gross
        # endpoint, so full-history mix × windowed gross breaks the
        # wiki-mandated identity "residual line endpoint == residual
        # waterfall bar". (The daily path below overrides again from its
        # own chart endpoints, same invariant.)
        if abs(gross_geom) > 1e-12:
            layer_attr = {
                "market":    (prod_l1    - 1.0)       / gross_geom,
                "sector":    (prod_l2    - prod_l1)   / gross_geom,
                "subsector": (prod_l3    - prod_l2)   / gross_geom,
                "style":     (prod_style - prod_l3)   / gross_geom,
                "residual":  (prod_g     - prod_style)/ gross_geom,
            }

    # ── DAILY FUND RETURNS (ds_fund_returns_daily.zarr) ─────────────────
    # If the per-fund daily-returns cube exists, prefer it as the source
    # for cum_nav + cum_l*/cum_res — daily granularity, all 5 lines from
    # the same weighted aggregation, mathematically reconciled by
    # construction (gross == l1 + l2 + l3 + residual at every day).
    #
    # Selects lag_basis="report_date" per the F1 design spec — the
    # tearsheet shows the manager-attribution view (what was the manager
    # actually holding on each day). The available_at view is reserved
    # for the dashboard toggle (signal-research / no-look-ahead backtest).
    #
    # Falls through silently if the zarr isn't present, in which case the
    # existing monthly-NAV + quarterly-ds_portfolio logic above remains
    # the authority.
    try:
        fr = _open_fund_zarr(bw_fund_id, "ds_fund_returns_daily.zarr")
        # lag_basis coord ordering is locked: index 0 = report_date.
        lag_basis_arr = list(fr["lag_basis"][:])
        report_idx = lag_basis_arr.index("report_date")

        fr_teo = _decode_teo_array(fr["teo"])

        gross_d = fr["gross_return"][:, report_idx]
        l1_d    = fr["l1_market"][:, report_idx]
        l2_d    = fr["l2_sector"][:, report_idx]
        l3_d    = fr["l3_subsector"][:, report_idx]
        res_d   = fr["l3_residual"][:, report_idx]

        # Window to last nav_lookback_months. ~21 trading days/month.
        window_days = int(nav_lookback_months * 21)
        if len(fr_teo) > window_days:
            sl = slice(len(fr_teo) - window_days, len(fr_teo))
            fr_teo = fr_teo[sl]
            gross_d = gross_d[sl]
            l1_d, l2_d, l3_d, res_d = l1_d[sl], l2_d[sl], l3_d[sl], res_d[sl]

        # Drop pre-history days where coverage was 0 (no holdings yet).
        # gross_d == 0 exactly is a strong signal of "no positions"; we
        # could read weight_coverage too but the simpler check is fine.
        first_nonzero = next(
            (i for i, v in enumerate(gross_d) if abs(float(v)) > 1e-12),
            None,
        )
        if first_nonzero is not None and first_nonzero > 0:
            fr_teo = fr_teo[first_nonzero:]
            gross_d = gross_d[first_nonzero:]
            l1_d = l1_d[first_nonzero:]
            l2_d = l2_d[first_nonzero:]
            l3_d = l3_d[first_nonzero:]
            res_d = res_d[first_nonzero:]

        # Build cumulative series, anchored at 0% on day 0 (matches
        # stock_deep_dive's series_with_zero_start). Sequential
        # compounding through the ERM3 hierarchy gives the L*/Residual
        # decomposition; gross is the all-in compound.
        if len(fr_teo) > 0:
            gross_d_safe = np.nan_to_num(np.asarray(gross_d, dtype=np.float64), nan=0.0)
            l1_safe = np.nan_to_num(np.asarray(l1_d, dtype=np.float64), nan=0.0)
            l2_safe = np.nan_to_num(np.asarray(l2_d, dtype=np.float64), nan=0.0)
            l3_safe = np.nan_to_num(np.asarray(l3_d, dtype=np.float64), nan=0.0)
            res_safe = np.nan_to_num(np.asarray(res_d, dtype=np.float64), nan=0.0)

            cum_nav_new: list[tuple[str, float]] = []
            cum_l1_new:  list[tuple[str, float]] = []
            cum_l2_new:  list[tuple[str, float]] = []
            cum_l3_new:  list[tuple[str, float]] = []
            cum_res_new: list[tuple[str, float]] = []

            # Anchor row at 0% — index 0 of the daily series.
            anchor_d = str(fr_teo[0])
            cum_nav_new.append((anchor_d, 0.0))
            cum_l1_new.append((anchor_d, 0.0))
            cum_l2_new.append((anchor_d, 0.0))
            cum_l3_new.append((anchor_d, 0.0))
            cum_res_new.append((anchor_d, 0.0))

            prod_g = prod_l1 = prod_l2 = prod_l3 = 1.0
            for i in range(len(fr_teo)):
                d = str(fr_teo[i])
                prod_g  *= 1.0 + gross_d_safe[i]
                prod_l1 *= 1.0 + l1_safe[i]
                prod_l2 *= 1.0 + (l1_safe[i] + l2_safe[i])
                prod_l3 *= 1.0 + (l1_safe[i] + l2_safe[i] + l3_safe[i])
                cum_nav_new.append((d, prod_g - 1.0))
                cum_l1_new.append((d, prod_l1 - 1.0))
                cum_l2_new.append((d, prod_l2 - 1.0))
                cum_l3_new.append((d, prod_l3 - 1.0))
                # Residual = gross − sum of L1/L2/L3 contributions, in
                # cumulative space. Equivalent to compounding (1+res_d_i)
                # under the identity gross_d == l1+l2+l3+res_d.
                cum_res_new.append((d, prod_g - prod_l3))

            # Override the monthly/quarterly-based series above. The new
            # daily series is denser and self-consistent.
            #
            # NOTE (FF2 style leg): ds_fund_returns_daily.zarr is still the
            # pre-split daily cascade — it has no style strip, so its `res_d`
            # (= gross − L1 − L2 − L3) is style + idio combined. We therefore
            # clear cum_style here (no daily-scale style line is available) so
            # the monthly-derived cum_style above can't leak onto a daily-scale
            # chart. The monthly variance-share panel (from ds_portfolio, which
            # IS v4-split) still shows style separately. Splitting the daily
            # residual requires adding a style leg to fund_returns_daily
            # upstream (tracked separately).
            cum_nav   = cum_nav_new
            cum_l1    = cum_l1_new
            cum_l2    = cum_l2_new
            cum_l3    = cum_l3_new
            cum_style = []
            cum_res   = cum_res_new

            # When the daily-returns cube is present, recompute
            # layer_attribution from the SAME cascade endpoints that
            # drive the line chart so the Section I waterfall's bars
            # exactly match the line-chart cascade levels by
            # construction. Fractions are `(P_layer − P_prev) / PG`
            # per the cascade-telescoping identity; consumers multiply
            # by gross_pct to recover pp. Falls back to the
            # monthly-derived layer_attribution above only when the
            # daily block hasn't run (no ds_fund_returns_daily).
            PG_d = prod_g - 1.0
            if abs(PG_d) > 1e-12:
                layer_attr = {
                    "market":    (prod_l1 - 1.0)        / PG_d,
                    "sector":    (prod_l2 - prod_l1)    / PG_d,
                    "subsector": (prod_l3 - prod_l2)    / PG_d,
                    "residual":  (prod_g  - prod_l3)    / PG_d,
                }

            # Refresh tr_fund["1y"] from the daily series (last 252 days
            # compounded). Replaces the monthly-NAV-based calculation.
            if len(gross_d_safe) >= 252:
                ttm_window = gross_d_safe[-252:]
                tr_fund["1y"] = float(np.prod(1.0 + ttm_window) - 1.0)
    except (FileNotFoundError, KeyError) as e:
        # P.4 — surface the silent monthly downgrade so operators see
        # which funds are rendering coarse charts. The chart still draws
        # (cum_nav from the monthly NAV block above remains the
        # authority) but with ~12 monthly points instead of ~252 daily.
        # WARN-level: a missing daily store IS a degradation worth
        # noticing, not a normal absence.
        log.warning(
            "ds_fund_returns_daily.zarr unavailable for %s (%s); F1 chart "
            "falls back to monthly NAV granularity. Daily store is the "
            "preferred source for the cumulative-return strip.",
            bw_fund_id, type(e).__name__,
        )

    # ── ERM3 fit row from fund_fit_parquet ──────────────────────────
    # Joined ERM3 vs yfinance NAV stats (coverage, monthly correlation,
    # 5y endpoint delta) computed by Funds_DAG asset `fund_fit_parquet`.
    # Section III renders these in the fit card + drives the deterministic
    # narrative wording.
    #
    # WARN-on-silent-fallback per BWMACRO master backlog P.3 — missing
    # fund_fit.parquet collapses the entire Section III fit card to None,
    # which is a real degradation, not a normal absence. In prod
    # (render-svc on Cloud Run), the typical cause is FUNDS_DAG_DATA_ROOT
    # being unset, so `_funds_latest_path()` falls back to a sibling path
    # that doesn't exist when the SDK is installed in site-packages.
    # Surface that loudly.
    fit_kw: dict[str, Any] = {}
    try:
        import pandas as _pd
        fit_path = _funds_latest_path().parent / "fund_fit.parquet"
        if not fit_path.exists():
            log.warning(
                "fund_fit.parquet missing at %s for %s; Section III fit card "
                "renders blank (fit_coverage / correlation_monthly / "
                "delta_5y_pp etc. all None). Operational cause is usually "
                "FUNDS_DAG_DATA_ROOT unset on render-svc Cloud Run, or "
                "fund_fit.parquet not baked into the mounted root. See "
                "BWMACRO master backlog P.3 / O.9.",
                fit_path, bw_fund_id,
            )
        else:
            _fit_df = _pd.read_parquet(fit_path)
            _hit = _fit_df[_fit_df["bw_fund_id"] == bw_fund_id]
            if not len(_hit):
                log.warning(
                    "fund_fit.parquet present at %s but contains no row for "
                    "bw_fund_id=%s; Section III fit card renders blank for "
                    "this fund only (other funds presumably fine). Likely "
                    "the fund-fit asset run hasn't covered this id yet — "
                    "cross-check against the asset's expected universe.",
                    fit_path, bw_fund_id,
                )
            else:
                _r = _hit.iloc[0]
                def _opt(v: Any) -> Any:
                    if v is None or (isinstance(v, float) and not np.isfinite(v)):
                        return None
                    if hasattr(v, "item"):
                        return v.item()
                    return v
                fit_kw = {
                    "fit_coverage_mean":      _opt(_r.get("weight_coverage_mean")),
                    "fit_coverage_latest":    _opt(_r.get("weight_coverage_latest")),
                    "fit_correlation_monthly": _opt(_r.get("correlation_monthly")),
                    "fit_n_obs_monthly":      _opt(_r.get("n_obs_monthly")),
                    "fit_erm3_5y_return":     _opt(_r.get("erm3_5y_return")),
                    "fit_nav_5y_return":      _opt(_r.get("nav_5y_return")),
                    "fit_delta_5y_pp":        _opt(_r.get("delta_5y_pp")),
                    "fit_expense_ratio":      _opt(_r.get("expense_ratio")),
                    "fit_nav_vol_5y":         _opt(_r.get("nav_vol_5y_annualized")),
                    "fit_spy_vol_5y":         _opt(_r.get("spy_vol_5y_annualized")),
                    "fit_nav_beta":           _opt(_r.get("nav_beta_to_spy_5y")),
                    "fit_nav_alpha":          _opt(_r.get("nav_alpha_to_spy_5y_annualized")),
                    "fit_nav_r2_capm":        _opt(_r.get("nav_r2_to_spy_5y")),
                    "fit_capm_implied_vol":   _opt(_r.get("nav_capm_implied_vol_5y")),
                    "fit_residual_vol":       _opt(_r.get("nav_residual_vol_5y")),
                    "fit_erm3_multifactor_r2": _opt(_r.get("erm3_multifactor_r2_5y")),
                }
    except Exception as e:
        log.warning(
            "fund_fit.parquet read failed for %s: %s — Section III fit card "
            "renders blank. Falling through silently to preserve f1 render.",
            bw_fund_id, e,
        )

    # ── Portfolio variance shares ───────────────────────────────────────
    # Headline `portfolio_metrics`, in order of preference (`_basis` records it):
    #   1. "realized_strips" — cov(strip_k, gross)/var(gross) over the per-filing
    #      portfolio layer returns in ds_portfolio.zarr. Fully empirical: the
    #      residual share is the realized portfolio residual variance, so it
    #      already carries every cross-holding residual covariance — no "residuals
    #      are mutually uncorrelated" assumption. Matches the canonical
    #      /api/snapshot "realized_strips" basis (RiskModels_API #52). See
    #      Funds_DAG/docs/PORTFOLIO_DIVERSIFICATION_FIX_PLAN.md.
    #   2. "adjusted_attrs" — ds_portfolio.zarr `adjusted_*` attrs, if a Funds_DAG
    #      asset ever precomputes them (dormant — none does today).
    #   3. "naive_top_n" — sum per-holding L3 ER × weight over the top-N holdings.
    #      Over-states idio variance for diversified funds (skips the LLN
    #      cancellation diversified residuals provide). Last resort.
    # `portfolio_metrics_naive` always carries the naive number for the F1
    # side-by-side comparison, even when `portfolio_metrics` is realized.
    pm: dict[str, Any] | None = None
    pm_naive: dict[str, Any] | None = None
    pm_recent: dict[str, Any] | None = None

    realized = _realized_variance_shares(layer_series)
    if realized is not None:
        pm = {
            "l1_market_er":    realized["market"],
            "l2_sector_er":    realized["sector"],
            "l3_subsector_er": realized["subsector"],
            "style_er":        realized["style"],
            "l3_residual_er":  realized["residual"],
            "total_vol_ann":   realized.get("total_vol_ann", 0.0),
            "l2_sector_er_raw":    realized.get("sector_raw"),
            "l3_subsector_er_raw": realized.get("subsector_raw"),
            "style_er_raw":        realized.get("style_raw"),
            "_basis":          "realized_strips",
        }
        # "Recent" window = trailing slice of the same realized series, when
        # there's a meaningful distinction (strictly more than the floor).
        if len(layer_series) > _MIN_REALIZED_FUND_OBS:
            realized_recent = _realized_variance_shares(
                layer_series[-_MIN_REALIZED_FUND_OBS:]
            )
            if realized_recent is not None:
                pm_recent = {
                    "l1_market_er":    realized_recent["market"],
                    "l2_sector_er":    realized_recent["sector"],
                    "l3_subsector_er": realized_recent["subsector"],
                    "style_er":        realized_recent["style"],
                    "l3_residual_er":  realized_recent["residual"],
                    "total_vol_ann":   realized_recent.get("total_vol_ann", 0.0),
                    "l2_sector_er_raw":    realized_recent.get("sector_raw"),
                    "l3_subsector_er_raw": realized_recent.get("subsector_raw"),
                    "style_er_raw":        realized_recent.get("style_raw"),
                    "_basis":          "realized_strips_recent",
                }

    if pm is None and adj_variance_shares:
        pm = {
            "l1_market_er":    adj_variance_shares["market"],
            "l2_sector_er":    adj_variance_shares["sector"],
            "l3_subsector_er": adj_variance_shares["subsector"],
            "style_er":        adj_variance_shares.get("style", 0.0),
            "l3_residual_er":  adj_variance_shares["residual"],
            "total_vol_ann":   adj_variance_shares.get("total_vol_ann", 0.0),
            "_basis":          "adjusted_attrs",
        }
    if pm_recent is None and adj_variance_shares_recent:
        pm_recent = {
            "l1_market_er":    adj_variance_shares_recent["market"],
            "l2_sector_er":    adj_variance_shares_recent["sector"],
            "l3_subsector_er": adj_variance_shares_recent["subsector"],
            "style_er":        adj_variance_shares_recent.get("style", 0.0),
            "l3_residual_er":  adj_variance_shares_recent["residual"],
            "total_vol_ann":   adj_variance_shares_recent.get("total_vol_ann", 0.0),
            "_basis":          "adjusted_attrs_recent",
        }

    if holdings_list:
        agg = {"market": 0.0, "sector": 0.0, "subsector": 0.0,
               "style": 0.0, "residual": 0.0}
        for h in holdings_list:
            agg["market"]    += (h.market_share    or 0.0) * h.weight
            agg["sector"]    += (h.sector_share    or 0.0) * h.weight
            agg["subsector"] += (h.subsector_share or 0.0) * h.weight
            agg["style"]     += (h.style_share     or 0.0) * h.weight
            agg["residual"]  += (h.residual_share  or 0.0) * h.weight
        total = sum(agg.values())
        if total > 0:
            pm_naive = {
                "l1_market_er":    agg["market"]    / total,
                "l2_sector_er":    agg["sector"]    / total,
                "l3_subsector_er": agg["subsector"] / total,
                "style_er":        agg["style"]     / total,
                "l3_residual_er":  agg["residual"]  / total,
            }
        if pm is None and pm_naive is not None:
            pm = {**pm_naive, "_basis": "naive_top_n"}

    fd = FundData(
        bw_fund_id=bw_fund_id,
        ticker_primary=ticker_primary,
        fund_name=fund_name,
        teo=str(teo_str),
        equity_style_9box=equity_style,
        aum_usd=aum_usd,
        cum_nav_return=cum_nav,
        cum_bench_return=[],
        tr_fund=tr_fund,
        tr_bench={},
        benchmark_label="S&P 500",
        holdings=holdings_list,
        n_holdings=n_holdings_total,
        portfolio_metrics=pm,
        portfolio_metrics_naive=pm_naive,
        portfolio_metrics_recent=pm_recent,
        hedge_ratios=hr_out,
        layer_attribution=layer_attr,
        layer_returns_series=layer_series,
        cum_l1_market=cum_l1,
        cum_l2_sector=cum_l2,
        cum_l3_subsector=cum_l3,
        cum_style=cum_style,
        cum_l3_residual=cum_res,
        peer_cohort_label=equity_style,
        peer_cohort_size=identity.get("n_funds_in_cell_at_report_date"),
        **fit_kw,
    )
    # Default-enrich holdings against Supabase so render-svc + every other
    # public-SDK consumer gets real tickers / sector ETFs / per-stock L3
    # shares. Soft-fails when Supabase creds aren't wired (returns ``fd``
    # unchanged); callers can pass ``enrich=False`` to skip the round-trip
    # entirely. Closes MASTER_BACKLOG P.1.
    if enrich:
        fd = enrich_fund_data_with_supabase(fd)
    return fd


__all__ = [
    "FundHolding",
    "FundData",
    "from_fixture_row",
    "load_fund_from_fixture",
    "get_data_for_f1",
]
