"""13F portfolio time-series toolkit — bi-temporal long-book analytics.

Follows named 13F filers in two forms:

- **Gross** — the disclosed long book as a point-in-time-safe, bi-temporal
  xarray time series (:class:`PortfolioTimeSeries`), with factor decomposition
  and concentration metrics.
- **Market-neutral** — the same book with an ETF overlay that hedges out factor
  exposure (:class:`MarketNeutralOverlay`), generalizing ``riskmodels.pair_trade``
  netting from 2 legs to N legs (:func:`n_leg_hedge`).

Status: live-wired and validated against ``riskmodels-py`` 0.3.11 / in-tree 0.4.0.
:meth:`PortfolioTimeSeries.from_cik` resolves any filer CIK and pulls historical
vintages via ``get_filer_holdings(as_of=...)``; :meth:`MarketNeutralOverlay.construct`
builds the ETF overlay from live ``decompose()`` hedge ratios. Two things remain
deliberately unimplemented, both documented in HANDOFF.md §8:

- the K=4 style block in :mod:`portfolio_timeseries.factor_model` (methodology never
  delivered; a stub, not a bug);
- the hedge SIGN convention is pinned behind a flag rather than resolved
  (:data:`market_neutral_overlay.HEDGE_IS_SHORT_RATIO`, BWMACRO D.8.57).

The lag study itself (``build_lagged.py``) does not use the overlay at all.

Identifier note: identifiers are FIGI-resolved upstream. No S&P-licensed identifier is used
anywhere in this package (S&P Global proprietary — licensing).
"""

from __future__ import annotations

from .market_neutral_overlay import (
    HedgeOverlay,
    LegExposure,
    MarketNeutralOverlay,
    n_leg_hedge,
)
from .portfolio_timeseries import PortfolioTimeSeries
from .schema import as_of_snapshot, holdings_from_filing, make_mock_holdings

__all__ = [
    "PortfolioTimeSeries",
    "MarketNeutralOverlay",
    "LegExposure",
    "HedgeOverlay",
    "n_leg_hedge",
    "make_mock_holdings",
    "holdings_from_filing",
    "as_of_snapshot",
]
