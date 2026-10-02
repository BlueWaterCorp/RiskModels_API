"""MarketNeutralOverlay — ETF overlay that zeros a long book's factor exposure.

The overlay math is ``riskmodels.pair_trade``'s netting logic generalized from
2 legs to N legs: portfolio exposure to factor ``j`` is ``Σ_i (D_i · β_i,j)``
over positions ``i`` (with signed dollars ``D_i``), and the overlay shorts that
amount of the ETF mapped to factor ``j``. The pure core is :func:`n_leg_hedge`;
:meth:`MarketNeutralOverlay.construct` wires it to a live ``PortfolioTimeSeries``
snapshot, keying legs by the ETF ticker ``decompose()`` names for each position.

HEDGE SIGN CONVENTION — read before trusting any overlay number.
``decompose()["hedge"][etf]`` is converted to a per-dollar SHORT ratio by one
function, :func:`hedge_short_ratio`, controlled by :data:`HEDGE_IS_SHORT_RATIO`.
The SDK docstring (``client.py``) and fixture (``sdk/tests/test_decompose.py``)
say ``hedge[etf] == -hr`` — a signed position where NEGATIVE means short — which
is the opposite of the convention this module was built and validated on (the
July 2026 realized-beta charts, 76-110% beta reduction across four filers, only
reproduce if ``hedge`` is a positive short ratio). On 2026-09-22 the live API
returned MIXED signs across names (SPY positive for AXP/KO/BAC, negative for
NVDA; sector legs negative throughout), so neither convention could be confirmed
empirically that day. The flag pins the convention in one place and the tests in
``tests/test_hedge_sign.py`` pin its behaviour; flip the flag, not the call sites.
Tracked upstream as BWMACRO D.8.57.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

#: True  -> ``decompose()["hedge"][etf]`` is a POSITIVE per-dollar short ratio (what the
#:          overlay was validated on in July 2026).
#: False -> it is the SDK-documented signed position (``== -hr``, negative = short), and
#:          the ratio must be negated to become a short ratio.
#: This is the ONLY place the convention lives. See the module docstring and D.8.57.
HEDGE_IS_SHORT_RATIO: bool = True


def hedge_short_ratio(hedge_value: float) -> float:
    """Convert one ``decompose()["hedge"]`` entry to a per-dollar SHORT ratio under the
    convention selected by :data:`HEDGE_IS_SHORT_RATIO`. Every consumer of the hedge dict
    in this package must go through here so a sign change is a one-line, tested edit."""
    v = float(hedge_value)
    return v if HEDGE_IS_SHORT_RATIO else -v

import numpy as np


@dataclass(frozen=True)
class LegExposure:
    """One position's contribution to portfolio-level factor exposure.

    Args:
        ticker: Position identifier (FIGI-resolved upstream).
        dollars: Signed dollar exposure — positive for a long position. The
            sign flows straight into the netting, so a short leg passes a
            negative value (matching pair_trade's signed-dollar convention).
        factor_loadings: ``factor_name -> loading`` (the per-dollar exposure,
            analogous to pair_trade's ``*_hr`` hedge ratios).
    """

    ticker: str
    dollars: float
    factor_loadings: dict[str, float]  # factor_name -> loading


@dataclass(frozen=True)
class HedgeOverlay:
    """The ETF overlay that zeros the portfolio's factor exposure.

    Args:
        etf_shorts: ``etf_ticker -> dollar amount to short`` (negative = a long
            ETF position, e.g. from a net-negative factor loading).
        residual_exposure: ``factor_name -> exposure remaining after overlay``.
            ~0 for every factor covered by an ETF in the mapping; equal to the
            raw portfolio exposure for factors with no ETF mapped.
    """

    etf_shorts: dict[str, float]  # etf_ticker -> dollar amount to short
    residual_exposure: dict[str, float]  # factor_name -> exposure remaining after overlay


class MarketNeutralOverlay:
    """Constructs the market-neutral overlay for a disclosed long book.

    Mathematically identical to pair_trade's netting logic, generalized from
    2 legs to N legs.

    Args:
        portfolio: The disclosed long book (a ``Portfolio`` snapshot from
            :meth:`PortfolioTimeSeries.as_of`).
        factor_model: The K=4 factor model used to load each position; supplied
            once Aman's K=4 documentation lands.
    """

    def __init__(self, portfolio, factor_model=None):
        self.portfolio = portfolio
        self.factor_model = factor_model  # K=4 once available
        #: tickers whose decompose() carried no hedge block — left OUT of the overlay and
        #: reported here, so a vendor data gap is visible instead of silently filled.
        self.unhedged_tickers: list[str] = []

    def construct(self, client) -> HedgeOverlay:
        """Build the ETF overlay for ``self.portfolio`` from live hedge ratios.

        ``self.portfolio`` is an ``as_of`` snapshot Dataset (dims ``(ticker,)``
        with a ``dollars`` var). For each held position we call ``client.decompose``
        and read its ``hedge`` block — a ``{etf_ticker: per_dollar_hedge_ratio}``
        map on the industry axis (market + sector + subsector). Because sector /
        subsector ETFs differ by stock (XLK for AAPL, XLP for KO), we key legs by
        the ETF ticker itself: the position's short in ETF ``E`` is
        ``dollars * hedge[E]``, and :func:`n_leg_hedge` nets those across the book.

        Style is measurement-only (``hedgeable: false``), so it never enters the
        overlay — hedging stays on the industry axis, exactly as designed.

        Args:
            client: A live ``RiskModelsClient`` (has ``decompose``).

        Returns:
            A :class:`HedgeOverlay` whose ``etf_shorts`` are dollar amounts to
            short per ETF to zero the book's market/sector/subsector exposure.
        """
        snap = self.portfolio
        tickers = [str(t) for t in snap["ticker"].values]
        dollars = np.asarray(snap["dollars"].values, dtype=float)

        legs: list[LegExposure] = []
        etfs: set[str] = set()
        for tkr, d in zip(tickers, dollars):
            if np.isnan(d):
                continue
            dec = client.decompose(tkr)
            hedge = dec.get("hedge", {}) or {}
            if not hedge:
                # A name with no hedge block is a DATA GAP, not a zero exposure (e.g. AAPL on
                # 2026-09-22 returned hedge={} with er_populated=False). Record it rather than
                # silently renormalising the biggest position away.
                self.unhedged_tickers.append(tkr)
                continue
            loadings = {etf: hedge_short_ratio(r) for etf, r in hedge.items() if r is not None}
            legs.append(LegExposure(tkr, float(d), loadings))
            etfs.update(loadings)

        # Legs are already keyed by ETF ticker, so the factor→ETF map is identity.
        factor_to_etf = {etf: etf for etf in etfs}
        return n_leg_hedge(legs, factor_to_etf)


def n_leg_hedge(
    legs: Sequence[LegExposure],
    factor_to_etf: dict[str, str],
) -> HedgeOverlay:
    """Pure function: given N legs and a factor→ETF mapping, return the overlay.

    Generalizes ``riskmodels.pair_trade._net_hedge_legs`` from 2 legs to N. The
    portfolio's exposure to factor ``j`` is ``Σ_i (D_i · β_i,j)`` over positions
    ``i`` (signed dollars ``D_i``, loadings ``β_i,j``); the overlay shorts that
    dollar amount of the ETF mapped to factor ``j``. Contributions are
    accumulated by ETF ticker, so several factors mapping to the same ETF net
    into one short (exactly as pair_trade nets a shared ETF across its two legs).

    v1 pure-ETF assumption: each ETF loads 1.0 on its own factor and 0.0 on all
    others, so shorting ``exposure_j`` of ETF ``j`` zeros factor ``j`` without
    disturbing any other factor. Real ETFs aren't pure — extend later.

    Args:
        legs: The positions, each with signed dollars and per-factor loadings.
        factor_to_etf: ``factor_name -> etf_ticker`` (one-to-one, pure v1
            assumption above).

    Returns:
        A :class:`HedgeOverlay` where ``etf_shorts[etf_j] = Σ_i (D_i · β_i,j)``
        for each mapped factor ``j`` (negative = a long ETF position, from a
        net-negative loading). ``residual_exposure`` carries every factor seen:
        ``0.0`` for factors an ETF hedges, and the raw un-hedged exposure for
        factors with no ETF mapped.
    """
    # Portfolio-level exposure per factor: Σ_i (D_i · β_i,j).
    exposure: dict[str, float] = {}
    for leg in legs:
        for factor, loading in leg.factor_loadings.items():
            exposure[factor] = exposure.get(factor, 0.0) + leg.dollars * loading

    etf_shorts: dict[str, float] = {}
    residual_exposure: dict[str, float] = {}
    for factor, exp in exposure.items():
        etf = factor_to_etf.get(factor)
        if etf is not None:
            # Accumulate by ETF so factors sharing an ETF net into one short.
            etf_shorts[etf] = etf_shorts.get(etf, 0.0) + exp
            # Pure ETF removes this factor exactly.
            residual_exposure[factor] = 0.0
        else:
            # No ETF for this factor — the exposure stays un-hedged.
            residual_exposure[factor] = exp

    return HedgeOverlay(etf_shorts=etf_shorts, residual_exposure=residual_exposure)


__all__ = [
    "LegExposure",
    "HedgeOverlay",
    "MarketNeutralOverlay",
    "n_leg_hedge",
]
