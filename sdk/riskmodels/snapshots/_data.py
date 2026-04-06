"""Shared data-fetching layer for all snapshot pages.

One call to ``fetch_stock_context()`` produces everything needed for any
stock-level snapshot (R1, R2, P1, P2).  Each renderer picks the fields it
needs from the resulting ``StockContext`` dataclass.

API calls (4 total):
  1. POST /batch/analyze  → full_metrics + returns + meta (sector_etf, subsector_etf)
  2. GET  /ticker-returns?ticker={sector_etf}     → sector ETF daily returns
  3. GET  /ticker-returns?ticker={subsector_etf}   → subsector ETF daily returns
  4. GET  /ticker-returns?ticker=SPY               → market benchmark daily returns

All time series are DataFrames with columns [date, returns_gross, price_close, ...].
Stock history additionally carries L3 columns (l3_market_hr, l3_*_er, etc.).
ETF history has L3 columns as None (ETFs have no ERM3 decomposition).
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass, field
from typing import Any

import pandas as pd


# ---------------------------------------------------------------------------
# Data contract
# ---------------------------------------------------------------------------

@dataclass
class StockContext:
    """Everything a stock-level snapshot needs — fetched once, used by all pages.

    Attributes
    ----------
    ticker         : Canonical ticker (uppercased).
    company_name   : Human-readable company name (may default to ticker).
    teo            : Data as-of date (ISO string, e.g. "2026-04-02").
    universe       : Universe label (e.g. "uni_mc_3000").
    sector_etf     : Sector ETF ticker (e.g. "XLK") or None if unknown.
    subsector_etf  : Subsector ETF ticker (e.g. "SMH") or None if unknown.
    metrics        : Latest full_metrics dict (semantic keys: l3_mkt_hr, vol, etc.).
    market_cap     : Latest market cap in USD, or None.
    history        : Stock daily time series — date, returns_gross, price_close, l3_*.
    sector_returns : Sector ETF daily — date, returns_gross, price_close. None if unavailable.
    subsector_returns : Subsector ETF daily. None if unavailable.
    spy_returns    : SPY daily. None if unavailable.
    years          : Trailing window that was requested.
    sdk_version    : SDK version string for footer attribution.
    """

    ticker: str
    company_name: str
    teo: str
    universe: str
    sector_etf: str | None
    subsector_etf: str | None

    # Latest point-in-time metrics
    metrics: dict[str, Any]
    market_cap: float | None

    # Time series
    history: pd.DataFrame                         # stock
    sector_returns: pd.DataFrame | None = None    # sector ETF
    subsector_returns: pd.DataFrame | None = None # subsector ETF
    spy_returns: pd.DataFrame | None = None       # SPY

    years: float = 1.0
    sdk_version: str = "0.3.0"

    # ── Convenience properties ──────────────────────────────────────

    @property
    def date_start(self) -> str:
        """Earliest date in the stock history."""
        if self.history is not None and not self.history.empty:
            return str(self.history["date"].iloc[0])[:10]
        return self.teo

    @property
    def n_days(self) -> int:
        return len(self.history) if self.history is not None else 0


# ---------------------------------------------------------------------------
# Fetch
# ---------------------------------------------------------------------------

def _safe_etf_returns(
    client: Any,
    etf_ticker: str | None,
    years: int,
    label: str,
) -> pd.DataFrame | None:
    """Fetch ETF returns via get_ticker_returns; return None on failure."""
    if not etf_ticker:
        return None
    try:
        df = client.get_ticker_returns(etf_ticker, years=years)
        if df.empty:
            warnings.warn(f"No returns for {label} ETF '{etf_ticker}'", UserWarning, stacklevel=3)
            return None
        return df
    except Exception as exc:
        warnings.warn(
            f"Could not fetch {label} returns for '{etf_ticker}': {exc}",
            UserWarning,
            stacklevel=3,
        )
        return None


def fetch_stock_context(
    ticker: str,
    client: Any,
    *,
    years: int = 1,
    include_spy: bool = True,
) -> StockContext:
    """Fetch all data needed for stock-level snapshots.

    Makes 4 API calls:
      1. POST /batch/analyze  → full_metrics + meta (sector_etf, subsector_etf)
      2. GET  /ticker-returns → stock daily history (returns + L3 decomposition)
      3. GET  /ticker-returns → sector ETF daily
      4. GET  /ticker-returns → subsector ETF daily
      5. GET  /ticker-returns → SPY daily (if include_spy=True)

    Parameters
    ----------
    ticker      : Stock ticker (e.g. "NVDA").
    client      : RiskModelsClient instance.
    years       : Trailing window in years (default 1).
    include_spy : Also fetch SPY returns for relative performance (default True).

    Returns
    -------
    StockContext with all fields populated.
    """
    ticker = ticker.upper()

    # ── 1. Batch analyze → full_metrics + meta ──────────────────────
    batch_resp = client.batch_analyze(
        [ticker],
        ["full_metrics"],
        years=years,
        format="json",
    )
    # batch_resp is a PortfolioAnalysis or dict depending on client version
    # Handle both: raw dict from transport or PortfolioAnalysis dataclass
    if hasattr(batch_resp, "raw") and isinstance(batch_resp.raw, dict):
        results = batch_resp.raw.get("results", {})
    elif isinstance(batch_resp, dict):
        results = batch_resp.get("results", batch_resp)
    else:
        results = {}

    ticker_result = results.get(ticker, {})
    full_metrics = ticker_result.get("full_metrics", {})
    meta = ticker_result.get("meta", {})

    sector_etf = meta.get("sector_etf")
    subsector_etf = meta.get("subsector_etf")
    market_cap = full_metrics.get("market_cap")
    teo = str(full_metrics.get("date") or "N/A")[:10]
    company_name = full_metrics.get("name") or meta.get("name") or ticker
    universe = meta.get("universe") or "uni_mc_3000"

    # ── 2. Stock daily history ──────────────────────────────────────
    history = client.get_ticker_returns(ticker, years=years)
    if history.empty:
        raise ValueError(f"No history returned for {ticker}")

    # Override teo from history if available
    if not history.empty:
        teo = str(history["date"].iloc[-1])[:10]

    # ── 3–5. Benchmark returns ──────────────────────────────────────
    sector_returns = _safe_etf_returns(client, sector_etf, years, "sector")
    subsector_returns = _safe_etf_returns(client, subsector_etf, years, "subsector")
    spy_returns = _safe_etf_returns(client, "SPY", years, "market") if include_spy else None

    return StockContext(
        ticker=ticker,
        company_name=company_name,
        teo=teo,
        universe=universe,
        sector_etf=sector_etf,
        subsector_etf=subsector_etf,
        metrics=full_metrics,
        market_cap=market_cap,
        history=history,
        sector_returns=sector_returns,
        subsector_returns=subsector_returns,
        spy_returns=spy_returns,
        years=float(years),
    )


# ---------------------------------------------------------------------------
# Derived computations (used by multiple pages)
# ---------------------------------------------------------------------------

def trailing_returns(df: pd.DataFrame, windows: dict[str, int] | None = None) -> dict[str, float | None]:
    """Compute trailing total returns over standard windows.

    Parameters
    ----------
    df      : DataFrame with 'returns_gross' column (daily simple returns).
    windows : Dict mapping label → number of trading days.
              Default: {"1d": 1, "5d": 5, "1m": 21, "3m": 63, "1y": 252}.

    Returns
    -------
    Dict mapping label → cumulative return (as decimal, e.g. 0.05 = +5%).
    None if insufficient data.
    """
    if df is None or df.empty or "returns_gross" not in df.columns:
        return {}

    if windows is None:
        windows = {"1d": 1, "5d": 5, "1m": 21, "3m": 63, "1y": 245}

    returns = pd.to_numeric(df["returns_gross"], errors="coerce").fillna(0.0)
    n = len(returns)
    result: dict[str, float | None] = {}

    for label, days in windows.items():
        if n >= days:
            tail = returns.iloc[-days:]
            cum = float((1 + tail).prod() - 1)
            result[label] = cum
        else:
            result[label] = None

    return result


def cumulative_returns(df: pd.DataFrame) -> pd.Series:
    """Compute cumulative return series from daily gross returns.

    Returns a Series of (1+r).cumprod() - 1, same length as input.
    """
    if df is None or df.empty or "returns_gross" not in df.columns:
        return pd.Series(dtype=float)
    r = pd.to_numeric(df["returns_gross"], errors="coerce").fillna(0.0)
    return (1 + r).cumprod() - 1


def rolling_sharpe(df: pd.DataFrame, window: int = 63, annualize: int = 252) -> pd.Series:
    """Rolling annualised Sharpe ratio (assuming rf ≈ 0 for simplicity).

    Parameters
    ----------
    df        : DataFrame with 'returns_gross'.
    window    : Rolling window in trading days (default 63 = ~3 months).
    annualize : Trading days per year (default 252).
    """
    if df is None or df.empty or "returns_gross" not in df.columns:
        return pd.Series(dtype=float)
    r = pd.to_numeric(df["returns_gross"], errors="coerce").fillna(0.0)
    roll_mean = r.rolling(window).mean()
    roll_std = r.rolling(window).std()
    return (roll_mean / roll_std.replace(0, float("nan"))) * (annualize ** 0.5)


def max_drawdown_series(df: pd.DataFrame) -> pd.Series:
    """Underwater equity curve: drawdown from running peak (as negative decimal).

    Returns a Series where -0.10 means currently 10% below the peak.
    """
    if df is None or df.empty or "returns_gross" not in df.columns:
        return pd.Series(dtype=float)
    r = pd.to_numeric(df["returns_gross"], errors="coerce").fillna(0.0)
    cum = (1 + r).cumprod()
    running_max = cum.cummax()
    return cum / running_max - 1


def relative_returns(
    stock_df: pd.DataFrame,
    bench_df: pd.DataFrame | None,
    windows: dict[str, int] | None = None,
) -> dict[str, float | None]:
    """Trailing excess returns: stock minus benchmark over standard windows.

    Returns dict mapping label → excess return (decimal).
    """
    stock_tr = trailing_returns(stock_df, windows)
    bench_tr = trailing_returns(bench_df, windows) if bench_df is not None else {}

    result: dict[str, float | None] = {}
    for label in stock_tr:
        s = stock_tr.get(label)
        b = bench_tr.get(label)
        if s is not None and b is not None:
            result[label] = s - b
        else:
            result[label] = None
    return result
