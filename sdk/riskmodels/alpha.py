"""Turn a buy or sell signal into an alpha trade: the stock held against its L* ETF hedge basket.

``GET /hedge-basket/{ticker}`` returns signed ratios, in dollars of each ETF per dollar of stock, at the hedge level the
model keeps for the name (L1 market, L2 adds the sector ETF, L3 adds the subsector ETF). :func:`alpha_legs` scales those
ratios by a signal's dollar size. A buy holds the stock long and each hedge leg at its signed ratio (hedges are short for
a long stock). A sell multiplies every leg by -1.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Mapping

__all__ = ["AlphaLeg", "AlphaUnavailable", "alpha_legs"]


class AlphaUnavailable(ValueError):
    """The basket cannot be turned into trades (incomplete level, missing ratio, or malformed response)."""


@dataclass(frozen=True)
class AlphaLeg:
    """One leg of an alpha trade. ``dollars`` is signed (positive long, negative short); ``shares`` is signed or None."""

    symbol: str
    side: str
    dollars: float
    ratio: float
    shares: float | None = None


def alpha_legs(
    basket: Mapping[str, Any],
    direction: str,
    dollars: float,
    prices: Mapping[str, float] | None = None,
    *,
    whole_shares: bool = True,
) -> list[AlphaLeg]:
    """Scale a hedge-basket response to one signal.

    Args:
        basket: JSON body of ``GET /hedge-basket/{ticker}``.
        direction: ``"buy"`` or ``"sell"``.
        dollars: Positive dollar size of the stock leg.
        prices: Optional ``{symbol: price}``. When given, each leg also carries a share count.
        whole_shares: Round share counts toward zero (default) instead of keeping fractions.

    Raises:
        AlphaUnavailable: the recommended level is listed in ``incomplete_levels``, a leg ratio is missing, or the
            stock leg is not present with ratio 1.
        ValueError: bad ``direction`` or non-positive ``dollars``.
    """
    d = str(direction).strip().lower()
    if d not in ("buy", "sell"):
        raise ValueError(f"direction must be 'buy' or 'sell', got {direction!r}")
    if not (isinstance(dollars, (int, float)) and math.isfinite(dollars) and dollars > 0):
        raise ValueError("dollars must be a positive finite number")
    sign = 1.0 if d == "buy" else -1.0

    level = basket.get("recommended_hedge_level")
    if level and level in (basket.get("incomplete_levels") or []):
        raise AlphaUnavailable(f"{basket.get('ticker')}: hedge level {level} is incomplete ({basket.get('data_quality_flags')})")
    raw = basket.get("legs")
    if not raw:
        raise AlphaUnavailable(f"{basket.get('ticker')}: response has no legs")

    ticker = basket.get("ticker")
    legs: list[AlphaLeg] = []
    for leg in raw:
        sym = leg.get("leg")
        ratio = leg.get("position")
        if sym is None or ratio is None or not math.isfinite(float(ratio)):
            raise AlphaUnavailable(f"{ticker}: leg {sym!r} has no usable position")
        ratio = float(ratio)
        usd = sign * dollars * ratio
        shares = None
        if prices is not None:
            px = prices.get(sym)
            if px is None or not (px > 0):
                raise AlphaUnavailable(f"{ticker}: no price for {sym}")
            q = usd / px
            shares = float(math.trunc(q)) if whole_shares else q
        legs.append(AlphaLeg(symbol=sym, side="long" if usd > 0 else "short", dollars=usd, ratio=ratio, shares=shares))

    stock = [leg for leg in legs if leg.symbol == ticker]
    if len(stock) != 1 or abs(stock[0].ratio - 1.0) > 1e-9:
        raise AlphaUnavailable(f"{ticker}: stock leg missing or not at ratio 1")
    return legs
