"""Pairs-trade risk neutralization — long/short factor-hedge construction.

Given a long ticker, a short ticker, and a per-leg dollar notional, this
module returns the hedge trades required to neutralize the pair's factor
risk at four progressively deeper levels of the ERM3 cascade:

    naive  -- dollar-neutral long/short pair, no factor hedge
    L1     -- + market hedge (SPY)             -> net market beta = 0
    L2     -- + sector hedge                   -> net market + sector = 0
    L3     -- + subsector hedge                -> all factor layers = 0

It is the long/short-pair analogue of the single-position hedge: instead
of hedging one long stock, it nets the two legs' factor exposures and
hedges the *difference*. For a same-sector pair (e.g. INTC / AMD, both
XLK / SMH) the sector and subsector hedges collapse to one ETF leg each;
for a cross-sector pair they remain separate per-leg ETF legs.

Architecture
------------
Follows the SDK's fetch / compute separation, mirroring ``portfolio_math``:

    compute_pair_neutralization(long_body, short_body, ...)
        -> pure function over already-fetched GET /metrics bodies
    PairTradeNeutralization.from_tickers(client, ...)
        -> fetches both bodies via the client, then computes

Hedge ratios and ETF names are read from the canonical ``hedge_levels``
block (see ``riskmodels.mapping.extract_hedge_levels``), so this module
stays aligned with the L1/L2/L3 structure unified across API/MCP/SDK.

Notes
-----
A long/short pair is structurally ~2.0x gross *before* any hedge, so the
leverage cap is applied here to the *hedge-overlay* gross (hedge legs
only), not total gross. Cap semantics for pairs are flagged for review.

Examples
--------
>>> from riskmodels import RiskModelsClient
>>> from riskmodels.pair_trade import PairTradeNeutralization
>>> client = RiskModelsClient()
>>> pn = PairTradeNeutralization.from_tickers(client, "INTC", "AMD", 10_000)
>>> pn.recommended_level
'L2'
>>> pn.levels[0].net_sector_beta          # naive pair carries a sector tilt
-0.7297
>>> pn.to_dataframe()[["level", "gross_leverage", "within_leverage_cap"]]
   level  gross_leverage  within_leverage_cap
0  naive            2.00                 True
1     L1            2.03                 True
2     L2            3.80                 True
3     L3            4.31                False
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
    within_leverage_cap: bool


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
    recommended_level: LevelName
    levels: list[PairNeutralizationLevel]
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
    def recommended(self) -> PairNeutralizationLevel:
        """The deepest level whose hedge overlay fits under the cap."""
        return self.level(self.recommended_level)

    # -- serialization -----------------------------------------------------

    def summary_dict(self) -> dict[str, Any]:
        """Flat headline row for embedding in tables / LLM context."""
        rec = self.recommended
        return {
            "long_ticker": self.long_ticker,
            "short_ticker": self.short_ticker,
            "dollars_per_leg": self.dollars,
            "as_of": self.as_of,
            "same_sector": self.same_sector,
            "leverage_cap": self.leverage_cap,
            "recommended_level": self.recommended_level,
            "recommended_gross_leverage": rec.gross_leverage,
            "recommended_hedge_overlay_gross": rec.hedge_overlay_gross,
        }

    def to_dataframe(self) -> pd.DataFrame:
        """One row per level — the four-trade comparison table."""
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
                "within_leverage_cap": lvl.within_leverage_cap,
                "recommended": lvl.level == self.recommended_level,
            }
            for lvl in self.levels
        ]
        return pd.DataFrame(rows)

    def legs_dataframe(self) -> pd.DataFrame:
        """One row per (level, leg) — the executable trade detail."""
        rows = [
            {
                "level": lvl.level,
                "ticker": leg.ticker,
                "role": leg.role,
                "side": leg.side,
                "ratio": leg.ratio,
                "dollars": leg.dollars,
            }
            for lvl in self.levels
            for leg in lvl.legs
        ]
        return pd.DataFrame(rows)

    def to_csv(self, path: str | Path | None = None) -> str | None:
        """Write the four-trade comparison to CSV, or return it as a string."""
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
    ) -> "PairTradeNeutralization":
        """Fetch metrics for both legs via the client, then compute.

        ``client`` is a ``RiskModelsClient`` (or any object exposing
        ``get_metrics(ticker)``). This is the DATA step — no rendering.
        """
        long_body = _fetch_metrics_body(client, long_ticker)
        short_body = _fetch_metrics_body(client, short_ticker)
        return compute_pair_neutralization(
            long_body, short_body, dollars, leverage_cap=leverage_cap
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


def compute_pair_neutralization(
    long_body: Mapping[str, Any],
    short_body: Mapping[str, Any],
    dollars: float,
    *,
    leverage_cap: float | None = None,
) -> PairTradeNeutralization:
    """Compute the four neutralization levels from two GET /metrics bodies.

    Pure function — no I/O. ``long_body`` / ``short_body`` are the JSON
    bodies returned by GET /metrics (each must carry a ``hedge_levels``
    block, ``ticker``, and ideally ``teo`` / ``_metadata``).
    """
    long_ticker = str(long_body.get("ticker") or "").upper()
    short_ticker = str(short_body.get("ticker") or "").upper()
    if not long_ticker or not short_ticker:
        raise ValueError("both metrics bodies must carry a 'ticker'")
    if long_ticker == short_ticker:
        raise ValueError("long and short tickers must differ")
    if dollars <= 0:
        raise ValueError("dollars (per-leg notional) must be positive")

    hl_long = extract_hedge_levels(long_body)
    hl_short = extract_hedge_levels(short_body)
    if hl_long is None:
        raise ValueError(f"no hedge_levels block in metrics for {long_ticker}")
    if hl_short is None:
        raise ValueError(f"no hedge_levels block in metrics for {short_ticker}")

    D = float(dollars)
    cap = leverage_cap if leverage_cap is not None else _leverage_cap_from(long_body)
    as_of = str(long_body.get("teo") or short_body.get("teo") or "")
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

        gross = sum(abs(l.dollars) for l in legs) / D
        overlay = sum(abs(l.dollars) for l in legs if l.role == "hedge") / D

        levels.append(PairNeutralizationLevel(
            level=level,
            label=_LEVEL_LABEL[level],
            neutralizes=list(_LEVEL_FACTORS[level]),
            legs=legs,
            net_market_beta=net_mkt,
            net_sector_beta=net_sec,
            net_subsector_beta=net_sub,
            gross_leverage=round(gross, 4),
            hedge_overlay_gross=round(overlay, 4),
            within_leverage_cap=overlay <= cap,
        ))

    # Pair Lstar: deepest level whose hedge overlay fits under the cap.
    recommended: LevelName = "naive"
    for lvl in levels:
        if lvl.within_leverage_cap:
            recommended = lvl.level

    notes = [
        "Hedge ratios are orthogonalized ERM3 factor-model outputs, not "
        "trade recommendations.",
        f"Leverage cap {cap:.2f}x is applied to the hedge-overlay gross "
        "(hedge legs only) — a long/short pair is ~2.0x gross before any "
        "hedge. Cap semantics for a pair are pending review.",
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
        recommended_level=recommended,
        levels=levels,
        notes=notes,
        lineage=lineage,
    )


__all__ = [
    "PairTradeLeg",
    "PairNeutralizationLevel",
    "PairTradeNeutralization",
    "compute_pair_neutralization",
]
