"""Canonical Stock Snapshot — the single semantic object every renderer reads.

This module defines the **public contract** that splits the snapshot system
into a public math/primitives layer (this repo) and a private institutional
composition layer (BWMACRO). Every downstream surface — PDF, PNG, web,
agent summary, social preview — derives from a ``CanonicalStockSnapshot``.

The structure mirrors the canonical conceptual distinction:

    RETURN ATTRIBUTION   — what drove realized returns
    RISK DECOMPOSITION   — what drives variance / risk

These are **not** the same thing. The schema keeps them strictly separate.

What is here
------------
    CanonicalStockSnapshot   — top-level frozen dataclass; version-stamped
    Identity                 — ticker, name, as-of, sector/subsector ETFs
    CoreMetrics              — left-rail spine (beta, vol, residual ER, …)
    PerformanceAttribution   — Section I
    RiskDecomposition        — Section II
    PeerContext              — Section III
    HedgeBasis               — Section IV
    MacroBasis               — Section V
    CANONICAL_SCHEMA_VERSION — bump on shape change
    from_dd_data()           — adapter from DDData (existing pipeline)

What is NOT here
----------------
    - Editorial vocabulary or qualifier strings (those live in
      ``bwmacro/risk_interpretation/`` and reach the snapshot via the
      ``Judgment`` field, populated by the BWMACRO engine).
    - Premium institutional layouts (those live in
      ``bwmacro/snapshots/stock/``).
    - Any rendering logic. This file is data only.

The reference public renderer is :mod:`riskmodels.snapshots.reference_renderer`.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, TYPE_CHECKING

from ..interpretation import Judgment

if TYPE_CHECKING:
    from .stock_deep_dive import DDData


CANONICAL_SCHEMA_VERSION = "canonical-stock/1.0"


# ---------------------------------------------------------------------------
# Identity + left rail
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Identity:
    """Stable identity band — top of every rendering."""

    ticker: str
    company_name: str
    as_of: str                       # ISO date, e.g. "2026-04-08"
    sector_etf: str | None
    subsector_etf: str | None
    market_cap_usd: float | None
    universe: str = "uni_mc_3000"


@dataclass(frozen=True)
class CoreMetrics:
    """Fixed left-rail spine — present on every snapshot variant.

    Decomposition shares are percent-of-variance (sum to ~1.0 when present).
    Hedge ratios are factor betas (signed, dimensionless).
    """

    # Headline stats
    beta: float | None = None                 # market beta (1y daily)
    vol_23d: float | None = None              # 23-day vol (annualized)
    max_drawdown_pct: float | None = None     # worst peak-to-trough (signed)
    sharpe_252d: float | None = None          # 252d Sharpe

    # Residual / idiosyncratic
    residual_er: float | None = None          # residual explained return (pct)
    residual_vol: float | None = None         # residual vol (annualized)

    # Variance-share decomposition (Σ ≈ 1.0 when populated)
    market_share: float | None = None
    sector_share: float | None = None
    subsector_share: float | None = None
    residual_share: float | None = None


# ---------------------------------------------------------------------------
# Section I — Performance Attribution ("what drove returns?")
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class AttributionPoint:
    """One step in a sequential / telescoping return-attribution waterfall."""

    label: str                  # e.g. "Market", "Sector", "Subsector", "Residual", "Gross"
    value_pct: float            # cumulative or step contribution, in pct
    sequence: int               # ordering index for waterfall semantics


@dataclass(frozen=True)
class PerformanceAttribution:
    """Section I — return attribution over a window.

    `series` holds the geometric/sequential decomposition (Market → Sector →
    Subsector → Residual → Gross). Time-series fields are optional and used
    by chart-heavy renderers; tabular-only renderers can ignore them.
    """

    window_label: str                                            # "1Y", "3M", …
    window_start: str                                            # ISO date
    window_end: str                                              # ISO date
    series: list[AttributionPoint] = field(default_factory=list)

    # Optional: trailing-window scalar returns by entity
    trailing_returns: dict[str, float | None] = field(default_factory=dict)
    # Optional: cumulative curves keyed by entity (target / SPY / sector ETF / …)
    cumulative_curves: dict[str, list[tuple[str, float]]] = field(default_factory=dict)
    # Optional: drawdown series keyed by entity
    drawdown_curves: dict[str, list[tuple[str, float]]] = field(default_factory=dict)
    # True iff cumulative_curves uses combined factor returns (CFR), not gross ETF
    uses_combined_factor_returns: bool = False


# ---------------------------------------------------------------------------
# Section II — Risk Decomposition ("what drives variance?")
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class DecompositionPoint:
    """One row of variance-share decomposition."""

    label: str                  # "Market", "Sector", "Subsector", "Residual"
    share: float                # 0.0 – 1.0, fraction of total variance
    sequence: int               # display ordering


@dataclass(frozen=True)
class RiskDecomposition:
    """Section II — variance decomposition.

    Distinct from :class:`PerformanceAttribution`: variance shares answer
    "what drives risk?", not "what drove returns?". The two views often
    disagree (e.g. a stock can be variance-dominated by market while being
    return-driven by residual) — this is the central RiskModels insight
    the schema encodes.
    """

    total_variance: float | None = None
    components: list[DecompositionPoint] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Section III — Peer Context ("how unusual relative to peers?")
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class PeerRow:
    """One row of the peer cohort table."""

    ticker: str
    weight: float | None = None                 # cap weight in the cohort, 0–1
    market_cap_usd: float | None = None

    # Hedge ratios (factor betas)
    market_hr: float | None = None
    sector_hr: float | None = None
    subsector_hr: float | None = None

    # Residual quality
    residual_er: float | None = None            # pct
    residual_quality_pct: float | None = None   # cohort percentile, 0–100 (100 = best)
    gross_rank_pct: float | None = None         # cohort percentile, 0–100 (100 = best)


@dataclass(frozen=True)
class PeerContext:
    """Section III — target vs. cohort.

    `target` is the snapshot's stock; `peers` are its cap-weighted cohort.
    `selection_spread` is target.residual_er − cap-weighted-mean(peer.residual_er).
    """

    cohort_label: str                               # e.g. "IDGT subsector peers"
    cohort_size: int
    target: PeerRow
    peers: list[PeerRow] = field(default_factory=list)
    selection_spread: float | None = None
    target_vol: float | None = None
    peer_avg_vol: float | None = None


# ---------------------------------------------------------------------------
# Section IV — Hedge Basis ("how to isolate exposures?")
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class HedgeBasis:
    """Section IV — factor isolation via hedge ratios.

    Overlaps :class:`RiskDecomposition` semantically (both are dual views of
    the factor model) but kept distinct so renderers can show "how to
    construct the hedge" separately from "what variance to attribute".
    """

    market_hr: float | None = None              # L1 — broad market beta
    sector_hr: float | None = None              # L2 — sector beta
    subsector_hr: float | None = None           # L3 — subsector beta
    residual_quality_pct: float | None = None   # cohort percentile of residual ER


# ---------------------------------------------------------------------------
# Section V — Macro Basis ("what regimes influence residual?")
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class MacroBasis:
    """Section V — macro-factor correlations of the residual stream."""

    correlations: dict[str, float] = field(default_factory=dict)
    window_label: str = "252d"


# ---------------------------------------------------------------------------
# Top-level snapshot
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class CanonicalStockSnapshot:
    """Single semantic object backing every stock-snapshot surface.

    Renderers (PDF / PNG / web / agent / social) read this object — they
    do not call the API or recompute anything. The fetch layer produces
    one of these per (ticker, as-of); presentation is downstream.

    `judgment` carries the editorial layer when populated by the BWMACRO
    interpretation engine; the public reference renderer gracefully falls
    back to numeric headlines when it is None.
    """

    schema_version: str
    generated_utc: str

    identity: Identity
    core_metrics: CoreMetrics

    performance: PerformanceAttribution
    risk: RiskDecomposition

    peer: PeerContext | None = None
    hedge: HedgeBasis | None = None
    macro: MacroBasis | None = None

    judgment: Judgment | None = None

    # ---- JSON I/O ----------------------------------------------------------

    def to_json(self, path: str | Path) -> Path:
        import json
        p = Path(path)
        p.write_text(json.dumps(_to_jsonable(self), indent=2, default=str))
        return p

    @classmethod
    def from_json(cls, path: str | Path) -> "CanonicalStockSnapshot":
        import json
        raw = json.loads(Path(path).read_text())
        return _from_jsonable(raw)


# ---------------------------------------------------------------------------
# JSON serialization helpers
# ---------------------------------------------------------------------------

def _to_jsonable(snap: CanonicalStockSnapshot) -> dict[str, Any]:
    """Convert a snapshot to a plain-dict tree suitable for json.dumps."""
    return asdict(snap)


def _from_jsonable(raw: dict[str, Any]) -> CanonicalStockSnapshot:
    """Inverse of :func:`_to_jsonable`. Tolerant of missing optional sections."""

    def _opt(key: str, builder):
        v = raw.get(key)
        return builder(v) if v is not None else None

    identity = Identity(**raw["identity"])
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

    return CanonicalStockSnapshot(
        schema_version=raw["schema_version"],
        generated_utc=raw["generated_utc"],
        identity=identity,
        core_metrics=core,
        performance=performance,
        risk=risk,
        peer=peer,
        hedge=hedge,
        macro=macro,
        judgment=judgment,
    )


# ---------------------------------------------------------------------------
# Adapter: DDData → CanonicalStockSnapshot
# ---------------------------------------------------------------------------

def _g(d: dict, *keys: str) -> Any:
    """First non-None value among `keys`. Tolerates abbreviated/full schemas
    (``l3_market_hr`` vs ``l3_mkt_hr``). Mirrors :func:`interpretation._g`."""
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


def from_dd_data(
    dd: "DDData",
    *,
    judgment: Judgment | None = None,
    generated_utc: str | None = None,
) -> CanonicalStockSnapshot:
    """Convert a :class:`DDData` (existing pipeline) into the canonical schema.

    This is the migration bridge: every cached DD JSON in the repo can be
    replayed through the canonical pipeline without re-fetching. Use it to
    validate the contract against real shipped data before downstream
    renderers move off DDData.
    """
    from datetime import datetime, timezone

    p1 = dd.p1
    m = dict(p1.metrics or {})

    identity = Identity(
        ticker=p1.ticker,
        company_name=p1.company_name,
        as_of=p1.teo,
        sector_etf=p1.sector_etf,
        subsector_etf=p1.subsector_etf,
        market_cap_usd=_to_float(_g(m, "market_cap", "mc")),
        universe=p1.universe,
    )

    # ── Variance-share decomposition (l3_*_er normalized) ──────────────
    mkt_er = _to_float(_g(m, "l3_market_er", "l3_mkt_er")) or 0.0
    sec_er = _to_float(_g(m, "l3_sector_er", "l3_sec_er")) or 0.0
    sub_er = _to_float(_g(m, "l3_subsector_er", "l3_sub_er")) or 0.0
    res_er = _to_float(_g(m, "l3_residual_er", "l3_res_er")) or 0.0
    total_er = mkt_er + sec_er + sub_er + res_er

    def _share(x: float) -> float | None:
        return (x / total_er) if total_er > 0 else None

    core = CoreMetrics(
        beta=_to_float(_g(m, "l1_mkt_beta", "beta_252d", "beta")),
        vol_23d=_to_float(p1.vol_23d if p1.vol_23d is not None else _g(m, "vol_23d")),
        max_drawdown_pct=_to_float(p1.max_drawdown),
        sharpe_252d=_to_float(p1.sharpe_1y),
        residual_er=_to_float(res_er) if total_er > 0 else None,
        residual_vol=_to_float(_g(m, "residual_vol", "res_vol")),
        market_share=_share(mkt_er),
        sector_share=_share(sec_er),
        subsector_share=_share(sub_er),
        residual_share=_share(res_er),
    )

    # ── Section II: variance decomposition ─────────────────────────────
    components: list[DecompositionPoint] = []
    if total_er > 0:
        components = [
            DecompositionPoint("Market", mkt_er / total_er, 0),
            DecompositionPoint("Sector", sec_er / total_er, 1),
            DecompositionPoint("Subsector", sub_er / total_er, 2),
            DecompositionPoint("Residual", res_er / total_er, 3),
        ]
    risk = RiskDecomposition(
        total_variance=_to_float(_g(m, "stock_var", "variance")),
        components=components,
    )

    # ── Section I: performance attribution (window summary + curves) ───
    cum_stock = list(p1.cum_stock or [])
    window_start = cum_stock[0][0] if cum_stock else p1.teo
    window_end = cum_stock[-1][0] if cum_stock else p1.teo

    perf_series: list[AttributionPoint] = []  # geometric attribution lives in BWMACRO

    cumulative_curves: dict[str, list[tuple[str, float]]] = {}
    if cum_stock:
        cumulative_curves[p1.ticker] = cum_stock
    if p1.cum_spy:
        cumulative_curves["SPY"] = list(p1.cum_spy)
    if p1.cum_sector and p1.sector_etf:
        cumulative_curves[p1.sector_etf] = list(p1.cum_sector)
    if p1.cum_subsector and p1.subsector_etf:
        cumulative_curves[p1.subsector_etf] = list(p1.cum_subsector)

    drawdown_curves: dict[str, list[tuple[str, float]]] = {}
    if p1.dd_stock:
        drawdown_curves[p1.ticker] = list(p1.dd_stock)
    if p1.dd_spy:
        drawdown_curves["SPY"] = list(p1.dd_spy)

    trailing = {
        p1.ticker: _to_float(p1.tr_stock.get("1Y")) if p1.tr_stock else None,
        "SPY": _to_float(p1.tr_spy.get("1Y")) if p1.tr_spy else None,
    }
    if p1.sector_etf and p1.tr_sector:
        trailing[p1.sector_etf] = _to_float(p1.tr_sector.get("1Y"))
    if p1.subsector_etf and p1.tr_subsector:
        trailing[p1.subsector_etf] = _to_float(p1.tr_subsector.get("1Y"))

    performance = PerformanceAttribution(
        window_label="1Y",
        window_start=window_start,
        window_end=window_end,
        series=perf_series,
        trailing_returns=trailing,
        cumulative_curves=cumulative_curves,
        drawdown_curves=drawdown_curves,
        uses_combined_factor_returns=p1.cumulative_bench_lines_use_cfr,
    )

    # ── Section III: peer context ──────────────────────────────────────
    peer: PeerContext | None = None
    if dd.peer_comparison is not None:
        pc = dd.peer_comparison
        target_metrics = pc.target_metrics or {}
        target_row = PeerRow(
            ticker=pc.target_ticker,
            market_hr=_to_float(_g(target_metrics, "l3_market_hr", "l3_mkt_hr")),
            sector_hr=_to_float(_g(target_metrics, "l3_sector_hr", "l3_sec_hr")),
            subsector_hr=_to_float(_g(target_metrics, "l3_subsector_hr", "l3_sub_hr")),
            residual_er=_to_float(_g(target_metrics, "l3_residual_er", "l3_res_er")),
            residual_quality_pct=_to_float(
                (dd.peer_rankings.get(pc.target_ticker) or (None, None))[1]
            ),
            gross_rank_pct=_to_float(
                (dd.peer_rankings.get(pc.target_ticker) or (None, None))[0]
            ),
        )

        peer_rows: list[PeerRow] = []
        peer_detail = pc.peer_detail
        if peer_detail is not None and not peer_detail.empty:
            for tk, row in peer_detail.iterrows():
                rk = dd.peer_rankings.get(str(tk), (None, None))
                peer_rows.append(
                    PeerRow(
                        ticker=str(tk),
                        weight=_to_float(row.get("weight")),
                        market_cap_usd=_to_float(row.get("market_cap")),
                        market_hr=_to_float(row.get("l3_market_hr") or row.get("l3_mkt_hr")),
                        sector_hr=_to_float(row.get("l3_sector_hr") or row.get("l3_sec_hr")),
                        subsector_hr=_to_float(
                            row.get("l3_subsector_hr") or row.get("l3_sub_hr")
                        ),
                        residual_er=_to_float(
                            row.get("l3_residual_er") or row.get("l3_res_er")
                        ),
                        residual_quality_pct=_to_float(rk[1]),
                        gross_rank_pct=_to_float(rk[0]),
                    )
                )

        peer = PeerContext(
            cohort_label=pc.peer_group_label,
            cohort_size=len(peer_rows),
            target=target_row,
            peers=peer_rows,
            selection_spread=_to_float(pc.selection_spread),
            target_vol=_to_float(pc.target_vol),
            peer_avg_vol=_to_float(pc.peer_avg_vol),
        )

    # ── Section IV: hedge basis ────────────────────────────────────────
    hedge = HedgeBasis(
        market_hr=_to_float(_g(m, "l3_market_hr", "l3_mkt_hr")),
        sector_hr=_to_float(_g(m, "l3_sector_hr", "l3_sec_hr")),
        subsector_hr=_to_float(_g(m, "l3_subsector_hr", "l3_sub_hr")),
        residual_quality_pct=_to_float(
            (dd.peer_rankings.get(p1.ticker) or (None, None))[1]
        ),
    )

    # ── Section V: macro basis ─────────────────────────────────────────
    macro: MacroBasis | None = None
    if p1.macro_correlations:
        macro = MacroBasis(
            correlations={k: float(v) for k, v in p1.macro_correlations.items() if v is not None},
            window_label=p1.macro_window or "252d",
        )

    return CanonicalStockSnapshot(
        schema_version=CANONICAL_SCHEMA_VERSION,
        generated_utc=generated_utc or datetime.now(timezone.utc).isoformat(timespec="seconds"),
        identity=identity,
        core_metrics=core,
        performance=performance,
        risk=risk,
        peer=peer,
        hedge=hedge,
        macro=macro,
        judgment=judgment,
    )
