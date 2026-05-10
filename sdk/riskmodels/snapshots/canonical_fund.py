"""Canonical Fund Snapshot — public contract for F1 (and future M1) artifacts.

Mirrors :mod:`canonical` for stocks. The analytical heart
(:class:`PerformanceAttribution`, :class:`RiskDecomposition`,
:class:`HedgeBasis`, :class:`MacroBasis`) is identical to the stock
canonical — both derive from a holdings-reconstructed portfolio. Funds and
13F filers diverge only on identity, peer-cohort dimensions, and filing-lag
semantics.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

from ..interpretation import Judgment
from ._fund_data import FundData, FundHolding
from .canonical import (
    AomProvenance,
    AttributionPoint,
    CANONICAL_ONTOLOGY_VERSION,
    CoreMetrics,
    DecompositionPoint,
    HedgeBasis,
    MacroBasis,
    OBSERVATION_MODES,
    PeerContext,
    PeerRow,
    PerformanceAttribution,
    RiskDecomposition,
    TemporalContext,
)

CANONICAL_FUND_SCHEMA_VERSION = "canonical-fund/1.0"


# ---------------------------------------------------------------------------
# Identity + portfolio
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FilerMetadata:
    """13F filer-specific identity fields. Populated for M1, None for F1."""

    cik: str
    filer_type: str | None = None
    aum_tier: str | None = None
    coverage: str = "equity_sleeve"


@dataclass(frozen=True)
class FundIdentity:
    """Stable identity band for a fund or 13F filer."""

    symbol_id: str
    name: str
    as_of: str
    fund_family: str | None = None
    share_class_count: int | None = None
    expense_ratio: float | None = None
    aum_usd: float | None = None
    inception_date: str | None = None
    filer_metadata: FilerMetadata | None = None


@dataclass(frozen=True)
class HoldingRow:
    """One position in a fund's reconstructed portfolio at as_of."""

    ticker: str
    weight: float
    market_value_usd: float | None = None
    shares: float | None = None
    market_share: float | None = None
    sector_share: float | None = None
    subsector_share: float | None = None
    residual_share: float | None = None


@dataclass(frozen=True)
class FundPortfolio:
    """Holdings detail block — top-N positions with decomposition."""

    holdings: list[HoldingRow] = field(default_factory=list)
    total_holdings_count: int = 0
    coverage_pct: float | None = None


@dataclass(frozen=True)
class CanonicalFundSnapshot:
    """Public contract for F1 / M1 fund-shape snapshots."""

    schema_version: str
    generated_utc: str

    identity: FundIdentity
    core_metrics: CoreMetrics
    performance: PerformanceAttribution
    risk: RiskDecomposition
    portfolio: FundPortfolio

    peer: PeerContext | None = None
    hedge: HedgeBasis | None = None
    macro: MacroBasis | None = None

    judgment: Judgment | None = None
    aom: AomProvenance | None = None
    temporal: TemporalContext | None = None

    ontology_version: str = CANONICAL_ONTOLOGY_VERSION

    def to_json(self, path: str | Path) -> Path:
        import json

        p = Path(path)
        p.write_text(json.dumps(_to_jsonable(self), indent=2, default=str))
        return p

    @classmethod
    def from_json(cls, path: str | Path) -> CanonicalFundSnapshot:
        import json

        raw = json.loads(Path(path).read_text())
        return _from_jsonable(raw)


def _to_jsonable(snap: CanonicalFundSnapshot) -> dict[str, Any]:
    return asdict(snap)


def _filer_from_raw(m: dict[str, Any] | None) -> FilerMetadata | None:
    if m is None:
        return None
    return FilerMetadata(
        cik=str(m["cik"]),
        filer_type=m.get("filer_type"),
        aum_tier=m.get("aum_tier"),
        coverage=str(m.get("coverage", "equity_sleeve")),
    )


def _holding_from_raw(h: dict[str, Any]) -> HoldingRow:
    return HoldingRow(
        ticker=str(h["ticker"]),
        weight=float(h["weight"]),
        market_value_usd=_to_float(h.get("market_value_usd")),
        shares=_to_float(h.get("shares")),
        market_share=_to_float(h.get("market_share")),
        sector_share=_to_float(h.get("sector_share")),
        subsector_share=_to_float(h.get("subsector_share")),
        residual_share=_to_float(h.get("residual_share")),
    )


def _from_jsonable(raw: dict[str, Any]) -> CanonicalFundSnapshot:
    def _opt(key: str, builder):
        v = raw.get(key)
        return builder(v) if v is not None else None

    id_raw = raw["identity"]
    filer_raw = id_raw.get("filer_metadata")
    identity = FundIdentity(
        symbol_id=id_raw["symbol_id"],
        name=id_raw["name"],
        as_of=id_raw["as_of"],
        fund_family=id_raw.get("fund_family"),
        share_class_count=id_raw.get("share_class_count"),
        expense_ratio=_to_float(id_raw.get("expense_ratio")),
        aum_usd=_to_float(id_raw.get("aum_usd")),
        inception_date=id_raw.get("inception_date"),
        filer_metadata=_filer_from_raw(filer_raw) if filer_raw else None,
    )
    core = CoreMetrics(**raw["core_metrics"])

    perf_raw = raw["performance"]
    series = [AttributionPoint(**p) for p in perf_raw.get("series", [])]
    performance = PerformanceAttribution(
        window_label=perf_raw["window_label"],
        window_start=perf_raw["window_start"],
        window_end=perf_raw["window_end"],
        series=series,
        trailing_returns=perf_raw.get("trailing_returns", {}),
        cumulative_curves={
            k: [(str(d), float(v)) for d, v in lst]
            for k, lst in perf_raw.get("cumulative_curves", {}).items()
        },
        drawdown_curves={
            k: [(str(d), float(v)) for d, v in lst]
            for k, lst in perf_raw.get("drawdown_curves", {}).items()
        },
        uses_combined_factor_returns=bool(perf_raw.get("uses_combined_factor_returns", False)),
    )

    risk_raw = raw["risk"]
    risk = RiskDecomposition(
        total_variance=risk_raw.get("total_variance"),
        components=[DecompositionPoint(**c) for c in risk_raw.get("components", [])],
    )

    port_raw = raw["portfolio"]
    portfolio = FundPortfolio(
        holdings=[_holding_from_raw(h) for h in port_raw.get("holdings", [])],
        total_holdings_count=int(port_raw.get("total_holdings_count", 0)),
        coverage_pct=_to_float(port_raw.get("coverage_pct")),
    )

    peer = _opt(
        "peer",
        lambda p: PeerContext(
            cohort_label=p["cohort_label"],
            cohort_size=int(p["cohort_size"]),
            target=PeerRow(**p["target"]),
            peers=[PeerRow(**r) for r in p.get("peers", [])],
            selection_spread=p.get("selection_spread"),
            target_vol=p.get("target_vol"),
            peer_avg_vol=p.get("peer_avg_vol"),
        ),
    )
    hedge = _opt("hedge", lambda h: HedgeBasis(**h))
    macro = _opt("macro", lambda m: MacroBasis(**m))
    judgment = _opt("judgment", lambda j: Judgment(**j))
    aom = _opt("aom", lambda a: AomProvenance(**a))
    temporal = _opt("temporal", lambda t: TemporalContext(**t))

    return CanonicalFundSnapshot(
        schema_version=raw["schema_version"],
        generated_utc=raw["generated_utc"],
        identity=identity,
        core_metrics=core,
        performance=performance,
        risk=risk,
        portfolio=portfolio,
        peer=peer,
        hedge=hedge,
        macro=macro,
        judgment=judgment,
        aom=aom,
        temporal=temporal,
        ontology_version=raw.get("ontology_version", CANONICAL_ONTOLOGY_VERSION),
    )


def _g(d: dict, *keys: str) -> Any:
    for k in keys:
        v = d.get(k)
        if v is not None:
            return v
    return None


def _to_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    import math

    return f if math.isfinite(f) else None


def _fund_tr_returns(dmap: dict[str, Any] | None, *keys: str) -> float | None:
    if not dmap:
        return None
    for k in keys:
        v = dmap.get(k)
        if v is not None:
            return _to_float(v)
    return None


def _next_hr_with_prefix(hr: dict[str, float], prefix: str) -> float | None:
    for k, raw in hr.items():
        if isinstance(k, str) and k.startswith(prefix):
            f = _to_float(raw)
            if f is not None:
                return f
    return None


def _holding_row_from_fund_holding(h: FundHolding) -> HoldingRow:
    return HoldingRow(
        ticker=h.ticker,
        weight=float(h.weight),
        market_value_usd=None,
        shares=None,
        market_share=_to_float(h.market_share),
        sector_share=_to_float(h.sector_share),
        subsector_share=_to_float(h.subsector_share),
        residual_share=_to_float(h.residual_share),
    )


def _portfolio_from_fund(fund_data: FundData) -> FundPortfolio:
    rows: list[HoldingRow] = []
    for h in fund_data.holdings:
        if isinstance(h, FundHolding):
            rows.append(_holding_row_from_fund_holding(h))
        elif isinstance(h, dict) and "ticker" in h and "weight" in h:
            rows.append(_holding_from_raw(h))
    total_count = fund_data.total_holdings_count
    if total_count <= 0:
        total_count = max(len(rows), int(getattr(fund_data, "n_holdings", 0)), 0)
    coverage = _to_float(getattr(fund_data, "coverage_pct", None))
    if coverage is None and rows:
        coverage = sum(h.weight for h in rows)
    return FundPortfolio(
        holdings=rows,
        total_holdings_count=total_count,
        coverage_pct=coverage,
    )


def from_fund_components(
    fund_data: FundData,
    *,
    generated_utc: str | None = None,
    aom_provenance: AomProvenance | None = None,
    temporal: TemporalContext | None = None,
) -> CanonicalFundSnapshot:
    """Build a :class:`CanonicalFundSnapshot` from :class:`FundData`.

    ``judgment`` is always ``None`` in the public adapter; editorial overlays
    are out of scope for the SDK (see F1 canonical spec).
    """
    from datetime import datetime, timezone

    if not isinstance(fund_data, FundData):
        raise TypeError(f"fund_data must be FundData, got {type(fund_data)!r}")

    m = dict(fund_data.portfolio_metrics or {})
    report_date = fund_data.teo
    filing_when = fund_data.filing_date if fund_data.filing_date else fund_data.teo

    identity = FundIdentity(
        symbol_id=fund_data.symbol_id,
        name=fund_data.fund_name,
        as_of=report_date,
        fund_family=fund_data.fund_family,
        share_class_count=fund_data.share_class_count,
        expense_ratio=_to_float(fund_data.expense_ratio),
        aum_usd=_to_float(fund_data.aum_usd),
        inception_date=fund_data.inception_date,
        filer_metadata=None,
    )

    mkt_er = _to_float(_g(m, "l1_market_er", "l3_market_er", "l3_mkt_er")) or 0.0
    sec_er = _to_float(_g(m, "l2_sector_er", "l3_sector_er", "l3_sec_er")) or 0.0
    sub_er = _to_float(_g(m, "l3_subsector_er", "l3_sub_er")) or 0.0
    res_er = _to_float(_g(m, "l3_residual_er", "l3_res_er")) or 0.0
    total_er = mkt_er + sec_er + sub_er + res_er

    def _share(x: float) -> float | None:
        return (x / total_er) if total_er > 0 else None

    core = CoreMetrics(
        beta=_to_float(_g(m, "l1_mkt_beta", "beta_252d", "beta")),
        vol_23d=_to_float(
            getattr(fund_data, "vol_23d", None)
            if getattr(fund_data, "vol_23d", None) is not None
            else _g(m, "vol_23d")
        ),
        max_drawdown_pct=_to_float(getattr(fund_data, "max_drawdown", None)),
        sharpe_252d=_to_float(getattr(fund_data, "sharpe_1y", None)),
        residual_er=_to_float(res_er) if total_er > 0 else None,
        residual_vol=_to_float(_g(m, "residual_vol", "res_vol")),
        market_share=_share(mkt_er),
        sector_share=_share(sec_er),
        subsector_share=_share(sub_er),
        residual_share=_share(res_er),
    )

    components: list[DecompositionPoint] = []
    if total_er > 0:
        components = [
            DecompositionPoint("Market", mkt_er / total_er, 0),
            DecompositionPoint("Sector", sec_er / total_er, 1),
            DecompositionPoint("Subsector", sub_er / total_er, 2),
            DecompositionPoint("Residual", res_er / total_er, 3),
        ]
    risk = RiskDecomposition(
        total_variance=_to_float(
            _g(m, "total_vol_ann", "adjusted_total_vol_ann", "stock_var", "variance", "portfolio_var")
        ),
        components=components,
    )

    cum_fund = list(
        getattr(fund_data, "cum_fund", None)
        or fund_data.cum_nav_return
        or []
    )
    window_start = cum_fund[0][0] if cum_fund else report_date
    window_end = cum_fund[-1][0] if cum_fund else report_date
    fund_label = fund_data.symbol_id

    cumulative_curves: dict[str, list[tuple[str, float]]] = {}
    if cum_fund:
        cumulative_curves[fund_label] = cum_fund
    cum_bench_lines = getattr(fund_data, "cum_spy", None) or fund_data.cum_bench_return
    if cum_bench_lines:
        cumulative_curves["SPY"] = list(cum_bench_lines)

    drawdown_curves: dict[str, list[tuple[str, float]]] = {}
    dd_fund = getattr(fund_data, "dd_fund", None) or ()
    dd_spy = getattr(fund_data, "dd_spy", None) or ()
    if dd_fund:
        drawdown_curves[fund_label] = list(dd_fund)
    if dd_spy:
        drawdown_curves["SPY"] = list(dd_spy)

    tr_fmap = getattr(fund_data, "tr_fund", None) or {}
    tr_bench = getattr(fund_data, "tr_bench", None) or {}
    trailing = {
        fund_label: _fund_tr_returns(tr_fmap, "1Y", "1y", "365d"),
        "SPY": _fund_tr_returns(getattr(fund_data, "tr_spy", None), "1Y", "1y", "365d")
        or _fund_tr_returns(tr_bench, "1Y", "1y", "365d"),
    }

    performance = PerformanceAttribution(
        window_label="1Y",
        window_start=window_start,
        window_end=window_end,
        series=[],
        trailing_returns=trailing,
        cumulative_curves=cumulative_curves,
        drawdown_curves=drawdown_curves,
        uses_combined_factor_returns=getattr(fund_data, "cumulative_bench_lines_use_cfr", False),
    )

    portfolio = _portfolio_from_fund(fund_data)

    hedge_ratios_raw = getattr(fund_data, "hedge_ratios", None) or {}
    hedge_ratios_f: dict[str, float] = {}
    for k_raw, raw in hedge_ratios_raw.items():
        fv = _to_float(raw)
        if fv is not None:
            hedge_ratios_f[str(k_raw)] = float(fv)
    hedge = HedgeBasis(
        market_hr=_to_float(_g(m, "l3_market_hr", "l3_mkt_hr"))
        or _to_float(hedge_ratios_f.get("l1_spy")),
        sector_hr=_to_float(_g(m, "l3_sector_hr", "l3_sec_hr"))
        or _next_hr_with_prefix(hedge_ratios_f, "l2_"),
        subsector_hr=_to_float(_g(m, "l3_subsector_hr", "l3_sub_hr"))
        or _next_hr_with_prefix(hedge_ratios_f, "l3_"),
        residual_quality_pct=_to_float(_g(m, "residual_quality_pct")),
    )

    macro: MacroBasis | None = None
    macro_corr = getattr(fund_data, "macro_correlations", None) or {}
    if macro_corr:
        correlations: dict[str, float] = {}
        for kk, vv in macro_corr.items():
            fc = _to_float(vv)
            if fc is not None:
                correlations[str(kk)] = float(fc)
        macro = MacroBasis(
            correlations=correlations,
            window_label=getattr(fund_data, "macro_window", None) or "252d",
        )

    temporal_context = temporal or TemporalContext(
        observation_mode="knowledge",
        report_date=report_date,
        filing_date=filing_when,
        extracted_at=None,
    )

    if temporal_context.observation_mode not in OBSERVATION_MODES:
        raise ValueError(
            f"temporal.observation_mode must be one of {OBSERVATION_MODES}, "
            f"got {temporal_context.observation_mode!r}"
        )

    aom = aom_provenance or AomProvenance(
        composition="F1",
        subject_type="fund",
        subject_id=fund_data.symbol_id,
        as_of=report_date,
        lenses=["return_attribution", "risk_decomposition", "exposure"],
        resolution="full_stack",
        view="snapshot",
        attribution_mode="incremental",
        observation_mode=temporal_context.observation_mode,
    )

    return CanonicalFundSnapshot(
        schema_version=CANONICAL_FUND_SCHEMA_VERSION,
        generated_utc=generated_utc or datetime.now(timezone.utc).isoformat(timespec="seconds"),
        identity=identity,
        core_metrics=core,
        performance=performance,
        risk=risk,
        portfolio=portfolio,
        peer=None,
        hedge=hedge,
        macro=macro,
        judgment=None,
        aom=aom,
        temporal=temporal_context,
        ontology_version=CANONICAL_ONTOLOGY_VERSION,
    )
