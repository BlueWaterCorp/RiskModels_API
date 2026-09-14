"""13F portfolio time-series toolkit — bi-temporal long-book analytics.

Follows named 13F filers in two forms:

- **Gross** — the disclosed long book as a point-in-time-safe, bi-temporal
  xarray time series (:class:`PortfolioTimeSeries`), with factor decomposition
  and concentration metrics.
- **Market-neutral** — the same book with an ETF overlay that hedges out factor
  exposure (:class:`MarketNeutralOverlay`), generalizing ``riskmodels.pair_trade``
  netting from 2 legs to N legs (:func:`n_leg_hedge`).

Build status (this scaffold): the N-leg netting math and the xarray schema /
``as_of()`` logic are implemented offline against mock data. Live wiring is
blocked upstream:

- :meth:`PortfolioTimeSeries.from_cik` — blocked on V4 API bi-temporal fields.
- :meth:`PortfolioTimeSeries.factor_decomposition_series` and the K=4
  residualization in :mod:`portfolio_timeseries.factor_model` — blocked on the
  K=4 factor-model documentation (style block methodology).

Identifier note: identifiers are FIGI-resolved upstream. CUSIP is never used
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
