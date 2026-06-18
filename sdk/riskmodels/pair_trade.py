"""Pairs-trade risk neutralization — long/short factor-hedge construction.

Construction
------------
This module builds a DOLLAR-NEUTRAL pair (equal-notional, opposite-signed
legs) with factor risk hedged via an ETF OVERLAY. Asymmetric leg notionals
(long $X / short $Y) are out of scope for v1 — call sites must pass a single
``dollars`` value used for both legs. The ETF overlay stacks on the inherent
~2x pair gross, which is why the leverage-cap basis (``cap_basis="overlay"``
vs ``"total"``) matters.

The headline recommendation is a **netted per-leg-Lstar trade**: each leg is
hedged to its OWN ``statistical_lstar`` (the engine's canonical per-name
warrant), and the resulting ETF legs are netted. Netting per-leg hedges *is*
hedging the net pair exposure — for a shared ETF the netted leg is exactly
``D*hr_long - D*hr_short`` (the net factor exposure), with each leg's
inclusion gated by that leg's own Lstar. This is not a uniform L1/L2/L3 level
and may be mixed (e.g. long L3 / short L1).

The naive/L1/L2/L3 table (``levels``) is kept as an optional COMPARISON
artifact — it is no longer where the recommendation comes from:

    naive  -- dollar-neutral long/short pair, no factor hedge
    L1     -- + market hedge (SPY)             -> net market beta = 0
    L2     -- + sector hedge                   -> net market + sector = 0
    L3     -- + subsector hedge                -> all factor layers = 0

For a same-sector pair (e.g. INTC / AMD, both XLK / SMH) the sector and
subsector hedges collapse to one ETF leg each; for a cross-sector pair they
remain separate per-leg ETF legs.

Architecture
------------
Follows the SDK's fetch / compute separation, mirroring ``portfolio_math``:

    compute_pair_neutralization(long_body, short_body, ...)
        -> pure function over already-fetched GET /metrics bodies
    PairTradeNeutralization.from_tickers(client, ...)
        -> fetches both bodies via the client, then computes

Hedge ratios, ETF names, and per-leg ``statistical_lstar`` are read from the
canonical ``hedge_levels`` block (see ``riskmodels.mapping.extract_hedge_levels``),
so this module stays aligned with the L1/L2/L3 structure unified across
API/MCP/SDK.

Notes
-----
A long/short pair is structurally ~2.0x gross *before* any hedge, so the
leverage cap is applied here to the *hedge-overlay* gross (hedge legs only)
by default, or to total gross with ``cap_basis="total"``. The cap is a FLAG
on the recommendation (``capped_by_leverage``), not a step-down trigger —
stepping a leg down to fit the cap is an explicit leverage decision left to
the caller.

Examples
--------
>>> from riskmodels import RiskModelsClient
>>> from riskmodels.pair_trade import PairTradeNeutralization
>>> client = RiskModelsClient()
>>> pn = PairTradeNeutralization.from_tickers(client, "INTC", "AMD", 10_000)
>>> pn.recommended_level          # per-leg Lstar label (both legs L3 here)
'L3'
>>> pn.recommended.capped_by_leverage   # L3 netted overlay busts the 2.0x cap
True
>>> pn.levels[0].net_sector_beta        # naive pair carries a sector tilt
-0.7297
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import pandas as pd

from .legends import SHORT_ERM3_LEGEND
from .lineage import RiskLineage
from .mapping import extract_hedge_levels

LevelName = Literal["naive", "L1", "L2", "L3"]

# Factor layers each level neutralizes (in cascade order).
_LEVEL_FACTORS: dict[LevelName, tuple[str, ...]] = {
    "naive": (),
    "L1": ("market",),
    "L2": ("market", "sector"),
    "L3": ("market", "sector", "subsector"),
}

# Hedge legs below this fraction of the per-leg notional are treated as
# noise and dropped (a near-perfectly-offsetting same-sector pair can
# produce a residual factor leg that rounds to a sub-dollar amount).
_MIN_HEDGE_LEG_FRACTION = 1e-4

_DEFAULT_LEVERAGE_CAP = 2.0

_LEVEL_LABEL: dict[LevelName, str] = {
    "naive": "Naive dollar-neutral pair",
    "L1": "Market-neutralized",
    "L2": "Market + sector neutralized",
    "L3": "Market + sector + subsector neutralized",
}


# ---------------------------------------------------------------------------
# Result objects
# ---------------------------------------------------------------------------

@dataclass
class PairTradeLeg:
    """One leg of a neutralization trade.

    ``dollars`` is signed: positive = long, negative = short.
    ``ratio`` is the leg size as a signed multiple of the per-leg notional.
    """

    ticker: str
    role: Literal["pair", "hedge"]
    side: Literal["long", "short"]
    ratio: float
    dollars: float


@dataclass
class PairNeutralizationLevel:
    """One neutralization level: the trade legs plus its risk outcome."""

    level: LevelName
    label: str
    neutralizes: list[str]
    legs: list[PairTradeLeg]
    # Net per-dollar factor betas of the pair *after* this level's hedges.
    # Neutralized layers are ~0 by construction; deeper layers remain.
    net_market_beta: float
    net_sector_beta: float
    net_subsector_beta: float
    gross_leverage: float        # sum(|leg $|) / per-leg notional
    hedge_overlay_gross: float   # sum(|hedge leg $|) / per-leg notional
    # Cap-basis figures (Review C). overlay_gross / total_gross are dollar
    # amounts; binding_leverage is the basis-aware leverage the cap binds on.
    overlay_gross: float         # sum(|hedge leg $|), in dollars
    total_gross: float           # base (pair legs) + overlay, in dollars
    binding_leverage: float      # (overlay or total) / per-leg notional
    within_leverage_cap: bool    # binding_leverage <= leverage_cap
    capped_by_leverage: bool     # not within_leverage_cap (cap, not Lstar)


@dataclass
class NettedPairRecommendation:
    """The headline recommended trade: each leg hedged to its OWN Lstar, netted.

    Built by hedging the long leg to ``long_lstar`` and the short leg to
    ``short_lstar`` (each leg's engine-canonical ``statistical_lstar``), then
    netting the per-leg ETF legs. The level may be mixed across legs, so there
    is no single L1/L2/L3 — ``PairTradeNeutralization.recommended_level`` gives
    a human-readable label (e.g. ``"L3"`` or ``"L3/L1"``).
    """

    long_lstar: LevelName
    short_lstar: LevelName
    legs: list[PairTradeLeg]     # 2 pair legs + netted ETF legs
    overlay_gross: float         # sum(|hedge leg $|), in dollars
    total_gross: float           # base (pair legs) + overlay, in dollars
    binding_leverage: float      # (overlay or total) / per-leg notional
    capped_by_leverage: bool     # binding_leverage > leverage_cap
    notes: list[str] = field(default_factory=list)


@dataclass
class PairTradeNeutralization:
    """Full pair-trade neutralization result across all four levels.

    Field/method conventions mirror ``PortfolioAnalysis`` (lineage, legend,
    ``summary_dict`` / ``to_dataframe`` / ``to_csv``).
    """

    long_ticker: str
    short_ticker: str
    dollars: float                    # per-leg notional
    as_of: str
    same_sector: bool
    leverage_cap: float
    cap_basis: str
    recommended: NettedPairRecommendation   # headline: netted per-leg-Lstar trade
    levels: list[PairNeutralizationLevel]    # optional comparison artifact
    # Convenience scalars DERIVED FROM ``recommended`` (the netted trade) — they
    # mirror its gross figures (not aggregates across levels) so a margin/risk-
    # desk caller need not reach into ``recommended``.
    overlay_gross: float          # netted trade's hedge-overlay gross ($)
    total_gross: float            # netted trade's total gross ($)
    binding_leverage: float       # netted trade's binding leverage
    notes: list[str] = field(default_factory=list)
    lineage: RiskLineage = field(default_factory=RiskLineage)
    legend: str = SHORT_ERM3_LEGEND

    # -- access ------------------------------------------------------------

    def level(self, name: LevelName) -> PairNeutralizationLevel:
        """Return one level by name."""
        for lvl in self.levels:
            if lvl.level == name:
                return lvl
        raise KeyError(name)

    @property
    def recommended_level(self) -> str:
        """Human-readable label for the netted recommendation's per-leg Lstar.

        Returns a single level (e.g. ``"L3"``) when both legs share an Lstar,
        or ``"long/short"`` (e.g. ``"L3/L1"``) when they differ. Kept for
        consumers that just want a label; the executable trade is
        ``self.recommended``.
        """
        r = self.recommended
        if r.long_lstar == r.short_lstar:
            return r.long_lstar
        return f"{r.long_lstar}/{r.short_lstar}"

    # -- serialization -----------------------------------------------------

    def summary_dict(self) -> dict[str, Any]:
        """Flat headline row — the netted recommendation, for tables / LLM context."""
        rec = self.recommended
        return {
            "long_ticker": self.long_ticker,
            "short_ticker": self.short_ticker,
            "dollars_per_leg": self.dollars,
            "as_of": self.as_of,
            "same_sector": self.same_sector,
            "leverage_cap": self.leverage_cap,
            "cap_basis": self.cap_basis,
            "recommended_level": self.recommended_level,
            "long_lstar": rec.long_lstar,
            "short_lstar": rec.short_lstar,
            "overlay_gross": self.overlay_gross,
            "total_gross": self.total_gross,
            "binding_leverage": self.binding_leverage,
            "capped_by_leverage": rec.capped_by_leverage,
        }

    def recommended_trade_dataframe(self) -> pd.DataFrame:
        """One row per leg of the HEADLINE netted recommended trade."""
        rows = [
            {
                "ticker": leg.ticker,
                "role": leg.role,
                "side": leg.side,
                "ratio": leg.ratio,
                "dollars": leg.dollars,
            }
            for leg in self.recommended.legs
        ]
        return pd.DataFrame(rows)

    def to_dataframe(self) -> pd.DataFrame:
        """One row per level — the four-level COMPARISON table (not the recommendation).

        The recommendation is the netted per-leg-Lstar trade; see
        ``recommended_trade_dataframe()`` / ``summary_dict()``.
        """
        rows = [
            {
                "level": lvl.level,
                "label": lvl.label,
                "neutralizes": ", ".join(lvl.neutralizes) or "—",
                "n_legs": len(lvl.legs),
                "net_market_beta": lvl.net_market_beta,
                "net_sector_beta": lvl.net_sector_beta,
                "net_subsector_beta": lvl.net_subsector_beta,
                "gross_leverage": lvl.gross_leverage,
                "hedge_overlay_gross": lvl.hedge_overlay_gross,
                "overlay_gross": lvl.overlay_gross,
                "total_gross": lvl.total_gross,
                "binding_leverage": lvl.binding_leverage,
                "within_leverage_cap": lvl.within_leverage_cap,
                "capped_by_leverage": lvl.capped_by_leverage,
            }
            for lvl in self.levels
        ]
        return pd.DataFrame(rows)

    def legs_dataframe(self) -> pd.DataFrame:
        """One row per (level, leg) — the comparison table's executable detail.

        ``capped_by_leverage`` is the leg's *level* flag (a per-name leverage
        signal), letting consumers distinguish "this level isn't warranted"
        from "this level doesn't fit your cap".
        """
        rows = [
            {
                "level": lvl.level,
                "ticker": leg.ticker,
                "role": leg.role,
                "side": leg.side,
                "ratio": leg.ratio,
                "dollars": leg.dollars,
                "capped_by_leverage": lvl.capped_by_leverage,
            }
            for lvl in self.levels
            for leg in lvl.legs
        ]
        return pd.DataFrame(rows)

    def to_csv(self, path: str | Path | None = None) -> str | None:
        """Write the four-level comparison table to CSV, or return it as a string.

        (The comparison artifact; for the headline trade use
        ``recommended_trade_dataframe()``.)
        """
        df = self.to_dataframe()
        if path is not None:
            df.to_csv(path, index=False)
            return None
        return df.to_csv(index=False)

    # -- construction ------------------------------------------------------

    @classmethod
    def from_tickers(
        cls,
        client: Any,
        long_ticker: str,
        short_ticker: str,
        dollars: float,
        *,
        leverage_cap: float | None = None,
        cap_basis: Literal["overlay", "total"] = "overlay",
    ) -> "PairTradeNeutralization":
        """Fetch metrics for both legs via the client, then compute.

        ``client`` is a ``RiskModelsClient`` (or any object exposing
        ``get_metrics(ticker)``). This is the DATA step — no rendering.
        """
        long_body = _fetch_metrics_body(client, long_ticker)
        short_body = _fetch_metrics_body(client, short_ticker)
        return compute_pair_neutralization(
            long_body, short_body, dollars,
            leverage_cap=leverage_cap, cap_basis=cap_basis,
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fetch_metrics_body(client: Any, ticker: str) -> dict[str, Any]:
    """Fetch one GET /metrics body, tolerating dict or 1-row DataFrame return."""
    body = client.get_metrics(ticker)
    if hasattr(body, "iloc"):  # pandas DataFrame
        if body.empty:
            raise ValueError(f"no metrics returned for {ticker!r}")
        body = body.iloc[0].to_dict()
    if not isinstance(body, Mapping):
        raise TypeError(f"get_metrics({ticker!r}) returned {type(body).__name__}")
    return dict(body)


def _leverage_cap_from(body: Mapping[str, Any]) -> float:
    metrics = body.get("metrics")
    if isinstance(metrics, Mapping):
        cap = metrics.get("leverage_cap_applied")
        if isinstance(cap, (int, float)) and cap > 0:
            return float(cap)
    return _DEFAULT_LEVERAGE_CAP


def _level_ratios(hedge_levels: Mapping[str, Any], level: LevelName) -> dict[str, float]:
    """{market,sector,subsector} hedge ratios for one level; unmodeled -> 0.0."""
    if level == "naive":
        return {"market": 0.0, "sector": 0.0, "subsector": 0.0}
    block = hedge_levels.get(level)
    block = block if isinstance(block, Mapping) else {}
    return {
        "market": block.get("market_hr") or 0.0,
        "sector": block.get("sector_hr") or 0.0,
        "subsector": block.get("subsector_hr") or 0.0,
    }


def _factor_etf(hedge_levels: Mapping[str, Any], level: LevelName, factor: str) -> str | None:
    """Resolve the hedge ETF for a factor at a level from the hedge_etfs block."""
    if factor == "market":
        return "SPY"
    block = hedge_levels.get(level)
    if not isinstance(block, Mapping):
        return None
    etfs = block.get("hedge_etfs")
    return etfs.get(factor) if isinstance(etfs, Mapping) else None


def _make_leg(ticker: str, role: str, dollars: float, notional: float) -> PairTradeLeg:
    return PairTradeLeg(
        ticker=ticker,
        role=role,  # type: ignore[arg-type]
        side="long" if dollars >= 0 else "short",
        ratio=round(dollars / notional, 6),
        dollars=round(dollars, 2),
    )


def _normalize_lstar(raw: Any) -> LevelName:
    """Coerce a statistical_lstar / recommended_level value to a LevelName.

    Accepts ``"L1"``/``"L2"``/``"L3"`` (any case), ``1``/``2``/``3``,
    and ``"L0"``/``"naive"``/``0`` (-> ``"naive"``). Raises on anything else.
    """
    s = str(raw).strip().upper()
    if s in ("L0", "NAIVE", "0", "NONE", ""):
        return "naive"
    if s in ("L1", "L2", "L3"):
        return s  # type: ignore[return-value]
    if s in ("1", "2", "3"):
        return f"L{s}"  # type: ignore[return-value]
    raise ValueError(f"unrecognized statistical_lstar value {raw!r}")


def _leg_lstar(hedge_levels: Mapping[str, Any], ticker: str) -> LevelName:
    """The engine's canonical per-leg Lstar: statistical_lstar, else recommended_level.

    Both live in the ``hedge_levels`` block. Raises if neither is present —
    an explicit data requirement for the netted recommendation (distinct from
    an explicit ``"naive"``, which means "no hedge warranted").
    """
    raw = hedge_levels.get("statistical_lstar")
    if raw is None:
        raw = hedge_levels.get("recommended_level")
    if raw is None:
        raise ValueError(
            f"no statistical_lstar (or recommended_level) in hedge_levels for "
            f"{ticker!r}; cannot build the per-leg-Lstar recommendation"
        )
    return _normalize_lstar(raw)


def _net_hedge_legs(
    hl_long: Mapping[str, Any],
    hl_short: Mapping[str, Any],
    long_lstar: LevelName,
    short_lstar: LevelName,
    D: float,
) -> list[PairTradeLeg]:
    """Net the two legs' Lstar hedges into a single ETF-overlay leg list.

    Each leg hedges the factors warranted by its OWN Lstar, using that leg's
    HRs at that level: long contributes ``+D*hr`` and short ``-D*hr`` into the
    factor's ETF. Shared ETFs net to one leg (``D*hr_long - D*hr_short``);
    distinct ETFs stay separate. Near-zero netted legs are dropped.
    """
    hedge_by_etf: dict[str, float] = {}
    for hl, lstar, sign in ((hl_long, long_lstar, +1.0), (hl_short, short_lstar, -1.0)):
        ratios = _level_ratios(hl, lstar)
        for factor in _LEVEL_FACTORS[lstar]:
            etf = _factor_etf(hl, lstar, factor)
            if etf:
                hedge_by_etf[etf] = hedge_by_etf.get(etf, 0.0) + ratios[factor] * sign * D
    legs: list[PairTradeLeg] = []
    for etf, amt in sorted(hedge_by_etf.items()):
        if abs(amt) < _MIN_HEDGE_LEG_FRACTION * D:
            continue
        legs.append(_make_leg(etf, "hedge", amt, D))
    return legs


def _build_netted_recommendation(
    long_ticker: str,
    short_ticker: str,
    hl_long: Mapping[str, Any],
    hl_short: Mapping[str, Any],
    long_lstar: LevelName,
    short_lstar: LevelName,
    D: float,
    cap: float,
    cap_basis: str,
) -> NettedPairRecommendation:
    """Assemble the headline netted per-leg-Lstar recommendation."""
    pair_legs = [
        _make_leg(long_ticker, "pair", +D, D),
        _make_leg(short_ticker, "pair", -D, D),
    ]
    hedge_legs = _net_hedge_legs(hl_long, hl_short, long_lstar, short_lstar, D)
    legs = pair_legs + hedge_legs

    overlay_gross = sum(abs(l.dollars) for l in hedge_legs)
    base_gross = sum(abs(l.dollars) for l in pair_legs)
    total_gross = base_gross + overlay_gross
    binding_gross = overlay_gross if cap_basis == "overlay" else total_gross
    binding_leverage = binding_gross / D
    capped = binding_leverage > cap

    notes: list[str] = []
    if long_lstar == short_lstar:
        notes.append(f"Both legs warrant {long_lstar}; netted single-level hedge.")
    else:
        notes.append(
            f"Mixed per-leg Lstar (long={long_lstar}, short={short_lstar}): the "
            "netted trade combines each leg's own warranted hedge."
        )
    for tkr, lstar in ((long_ticker, long_lstar), (short_ticker, short_lstar)):
        if lstar == "naive":
            notes.append(
                f"{tkr} Lstar=naive: contributes no hedge legs — its standalone "
                "residual is immaterial, so a sub-threshold factor stays unhedged "
                "in the net (consistent with Lstar)."
            )
    if capped:
        notes.append(
            f"Netted overlay binding leverage {binding_leverage:.2f}x exceeds the "
            f"{cap:.2f}x cap ({cap_basis} basis). Stepping a leg down is a separate "
            "leverage decision, left to the caller — not applied here."
        )

    return NettedPairRecommendation(
        long_lstar=long_lstar,
        short_lstar=short_lstar,
        legs=legs,
        overlay_gross=round(overlay_gross, 2),
        total_gross=round(total_gross, 2),
        binding_leverage=round(binding_leverage, 4),
        capped_by_leverage=capped,
        notes=notes,
    )


def compute_pair_neutralization(
    long_body: Mapping[str, Any],
    short_body: Mapping[str, Any],
    dollars: float,
    *,
    leverage_cap: float | None = None,
    cap_basis: Literal["overlay", "total"] = "overlay",
) -> PairTradeNeutralization:
    """Compute the netted per-leg-Lstar recommendation + the comparison table.

    Pure function — no I/O. ``long_body`` / ``short_body`` are the JSON
    bodies returned by GET /metrics (each must carry a ``hedge_levels`` block
    with the leg's ``statistical_lstar``, a ``ticker``, and ideally ``teo`` /
    ``_metadata``).

    Construction is a DOLLAR-NEUTRAL pair (equal ``dollars`` per leg,
    opposite-signed) with an ETF hedge OVERLAY. The headline ``recommended``
    trade hedges EACH leg to its own ``statistical_lstar`` and nets the ETF
    legs (may be a mixed level, e.g. long L3 / short L1). The naive/L1/L2/L3
    ``levels`` table is kept as a comparison artifact only.

    ``cap_basis`` selects which gross the leverage cap binds on:
    ``"overlay"`` (default) caps hedge-overlay gross only; ``"total"`` caps
    pair + hedge gross. It only affects the ``binding_leverage`` /
    ``capped_by_leverage`` FLAGS — it does NOT change which trade is
    recommended (that is Lstar-driven). Stepping a leg down to fit the cap is
    an explicit leverage decision left to the caller.

    Notes — Orthogonalization assumption
    ------------------------------------
    The reported ``net_market_beta`` / ``net_sector_beta`` /
    ``net_subsector_beta`` are set to 0 *by construction* once their layer is
    neutralized. This assumes the ERM3 cascade is **orthogonalized**: the
    marginal hedge ratio at each level (market, then +sector, then
    +subsector) is independent of the others under that assumption. That only
    holds if the cascade is genuinely orthogonal — stacked sector/subsector
    ETF legs carry their own market beta, which a naive stack can leak past
    these by-construction zeros.

    The empirical verification lives in
    ``test_realized_net_market_beta_is_zero_under_orthogonalization`` (live
    integration): it sums signed_notional × realized factor beta across all
    legs and asserts the residual is < 1% of gross. **If that test fails, do
    NOT trust ``net_market_beta == 0``** — the assumption is violated for that
    pair and the by-construction zero is masking real residual exposure.
    """
    long_ticker = str(long_body.get("ticker") or "").upper()
    short_ticker = str(short_body.get("ticker") or "").upper()
    if not long_ticker or not short_ticker:
        raise ValueError("both metrics bodies must carry a 'ticker'")
    if long_ticker == short_ticker:
        raise ValueError("long and short tickers must differ")
    if dollars <= 0:
        raise ValueError("dollars (per-leg notional) must be positive")
    if cap_basis not in ("overlay", "total"):
        raise ValueError(
            f"cap_basis must be 'overlay' or 'total', got {cap_basis!r}"
        )

    hl_long = extract_hedge_levels(long_body)
    hl_short = extract_hedge_levels(short_body)
    if hl_long is None:
        raise ValueError(f"no hedge_levels block in metrics for {long_ticker}")
    if hl_short is None:
        raise ValueError(f"no hedge_levels block in metrics for {short_ticker}")

    D = float(dollars)
    cap = leverage_cap if leverage_cap is not None else _leverage_cap_from(long_body)
    if long_body.get("teo") != short_body.get("teo"):
        raise ValueError(
            f"Pair legs have mismatched TEO timestamps "
            f"(long={long_body.get('teo')!r}, short={short_body.get('teo')!r}). "
            f"This usually means one leg is stale; refresh and retry."
        )
    as_of = str(long_body.get("teo") or "")
    lineage = RiskLineage.merge(
        RiskLineage.from_metadata(long_body.get("_metadata")),
        RiskLineage.from_metadata(short_body.get("_metadata")),
    )
    same_sector = (
        _factor_etf(hl_long, "L3", "sector") == _factor_etf(hl_short, "L3", "sector")
    )

    # Net per-dollar factor betas of the naive pair. The pair's hedge for
    # factor f is D*(hr_long - hr_short); exposure = -hedge, so the
    # per-dollar net beta is (hr_short - hr_long), measured at the cascade
    # level where each factor is the marginal layer.
    l1l, l1s = _level_ratios(hl_long, "L1"), _level_ratios(hl_short, "L1")
    l2l, l2s = _level_ratios(hl_long, "L2"), _level_ratios(hl_short, "L2")
    l3l, l3s = _level_ratios(hl_long, "L3"), _level_ratios(hl_short, "L3")
    naive_mkt = round(l1s["market"] - l1l["market"], 6)
    naive_sec = round(l2s["sector"] - l2l["sector"], 6)
    naive_sub = round(l3s["subsector"] - l3l["subsector"], 6)

    levels: list[PairNeutralizationLevel] = []
    for level in ("naive", "L1", "L2", "L3"):
        level: LevelName  # type: ignore[no-redef]
        rl = _level_ratios(hl_long, level)
        rs = _level_ratios(hl_short, level)

        legs: list[PairTradeLeg] = [
            _make_leg(long_ticker, "pair", +D, D),
            _make_leg(short_ticker, "pair", -D, D),
        ]

        # Accumulate hedges by ETF symbol: a same-sector pair nets into one
        # leg per factor; a cross-sector pair keeps separate per-leg legs.
        hedge_by_etf: dict[str, float] = {}
        for factor in _LEVEL_FACTORS[level]:
            long_etf = _factor_etf(hl_long, level, factor)
            short_etf = _factor_etf(hl_short, level, factor)
            if long_etf:
                hedge_by_etf[long_etf] = hedge_by_etf.get(long_etf, 0.0) + rl[factor] * D
            if short_etf:
                hedge_by_etf[short_etf] = hedge_by_etf.get(short_etf, 0.0) + rs[factor] * (-D)

        for etf, amt in sorted(hedge_by_etf.items()):
            if abs(amt) < _MIN_HEDGE_LEG_FRACTION * D:
                continue
            legs.append(_make_leg(etf, "hedge", amt, D))

        neutralized = set(_LEVEL_FACTORS[level])
        net_mkt = 0.0 if "market" in neutralized else naive_mkt
        net_sec = 0.0 if "sector" in neutralized else naive_sec
        net_sub = 0.0 if "subsector" in neutralized else naive_sub

        # Dollar grosses (Review C). overlay = hedge legs only; total = the
        # whole book (pair legs + hedge legs). base_gross is ~2*D for a
        # dollar-neutral pair but is summed from the legs to stay exact.
        overlay_gross = sum(abs(l.dollars) for l in legs if l.role == "hedge")
        base_gross = sum(abs(l.dollars) for l in legs if l.role == "pair")
        total_gross = base_gross + overlay_gross
        binding_gross = overlay_gross if cap_basis == "overlay" else total_gross
        binding_leverage = binding_gross / D

        levels.append(PairNeutralizationLevel(
            level=level,
            label=_LEVEL_LABEL[level],
            neutralizes=list(_LEVEL_FACTORS[level]),
            legs=legs,
            net_market_beta=net_mkt,
            net_sector_beta=net_sec,
            net_subsector_beta=net_sub,
            gross_leverage=round(total_gross / D, 4),
            hedge_overlay_gross=round(overlay_gross / D, 4),
            overlay_gross=round(overlay_gross, 2),
            total_gross=round(total_gross, 2),
            binding_leverage=round(binding_leverage, 4),
            within_leverage_cap=binding_leverage <= cap,
            capped_by_leverage=binding_leverage > cap,
        ))

    # Headline recommendation: hedge each leg to its OWN statistical_lstar and
    # net the ETF legs. This is the engine's canonical per-name warrant — NOT
    # the leverage-cap walk (which only flags capped_by_leverage per level).
    # Statistical Lstar is a per-name statistical judgement, handled per-leg
    # here; it is distinct from the leverage cap, which is a portfolio limit.
    long_lstar = _leg_lstar(hl_long, long_ticker)
    short_lstar = _leg_lstar(hl_short, short_ticker)
    recommended = _build_netted_recommendation(
        long_ticker, short_ticker, hl_long, hl_short,
        long_lstar, short_lstar, D, cap, cap_basis,
    )

    _basis_legs = "hedge legs only" if cap_basis == "overlay" else "pair + hedge legs"
    notes = [
        "Hedge ratios are orthogonalized ERM3 factor-model outputs, not "
        "trade recommendations.",
        "Recommendation is a netted per-leg-Lstar trade (each leg hedged to its "
        "own statistical_lstar); the naive/L1/L2/L3 table is a comparison "
        "artifact only.",
        f"Leverage cap {cap:.2f}x is applied to the {cap_basis}-basis gross "
        f"({_basis_legs}) as a FLAG (capped_by_leverage) — a long/short pair is "
        "~2.0x gross before any hedge; stepping down is left to the caller.",
    ]
    if not same_sector:
        notes.append(
            "Cross-sector pair: sector/subsector hedges are separate "
            "per-leg ETF legs rather than a single netted leg."
        )

    return PairTradeNeutralization(
        long_ticker=long_ticker,
        short_ticker=short_ticker,
        dollars=D,
        as_of=as_of,
        same_sector=same_sector,
        leverage_cap=cap,
        cap_basis=cap_basis,
        recommended=recommended,
        levels=levels,
        overlay_gross=recommended.overlay_gross,
        total_gross=recommended.total_gross,
        binding_leverage=recommended.binding_leverage,
        notes=notes,
        lineage=lineage,
    )


__all__ = [
    "PairTradeLeg",
    "PairNeutralizationLevel",
    "NettedPairRecommendation",
    "PairTradeNeutralization",
    "compute_pair_neutralization",
]
