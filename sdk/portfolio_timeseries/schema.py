"""xarray schema for bi-temporal 13F holdings + point-in-time-safe ``as_of``.

The storage layout is a single :class:`xarray.Dataset` per filer:

- dims: ``report_date`` (quarter-end the filing represents), ``available_date``
  (when the filing became public), ``ticker`` (FIGI-resolved upstream).
- data vars: ``shares``, ``dollars``, ``weight`` — all indexed by the three dims.
- coords: scalar ``cik`` on the whole Dataset.

:func:`make_mock_holdings` builds deterministic mock history for tests (no real
data). :func:`as_of_snapshot` is the anti-look-ahead core: it selects the most
recent snapshot whose ``available_date + lag_days`` has passed as of a query
date, filtering on ``available_date`` and NEVER ``report_date``.
"""

from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd
import xarray as xr

_DIMS = ("report_date", "available_date", "ticker")


def make_mock_holdings(
    cik: str,
    quarters: list[tuple[str, str]],  # (report_date, available_date) tuples
    tickers: list[str],
    seed: int = 0,
) -> xr.Dataset:
    """Deterministic mock 13F history for tests. No real data.

    Each filing is one ``(report_date, available_date)`` pair. The three dims
    form a Cartesian grid, but a filing only populates its own diagonal cell
    ``(report_date_i, available_date_i, :)`` — every off-diagonal
    ``(report_date_i, available_date_j)`` combination is NaN, since no filing
    reports quarter ``i`` yet becomes public on quarter ``j``'s date. ``weight``
    sums to 1.0 across tickers within each filing.

    Args:
        cik: The filer's Central Index Key (becomes a scalar coord).
        quarters: ``(report_date, available_date)`` ISO-date string pairs, one
            per disclosed filing.
        tickers: Position identifiers (FIGI-resolved upstream).
        seed: Deterministic seed for the synthetic shares/dollars/weight values.

    Returns:
        A :class:`xarray.Dataset` with dims ``(report_date, available_date,
        ticker)``, data vars ``shares``/``dollars``/``weight``, and a scalar
        ``cik`` coord.
    """
    report_dates = pd.to_datetime([rd for rd, _ in quarters])
    avail_dates = pd.to_datetime([ad for _, ad in quarters])
    n_q, n_t = len(quarters), len(tickers)

    shape = (n_q, n_q, n_t)
    shares = np.full(shape, np.nan)
    dollars = np.full(shape, np.nan)
    weight = np.full(shape, np.nan)

    rng = np.random.default_rng(seed)
    raw_shares = rng.uniform(1_000.0, 100_000.0, size=(n_q, n_t))
    prices = rng.uniform(10.0, 500.0, size=(n_q, n_t))
    for i in range(n_q):
        d = raw_shares[i] * prices[i]
        shares[i, i, :] = raw_shares[i]
        dollars[i, i, :] = d
        weight[i, i, :] = d / d.sum()

    ds = xr.Dataset(
        {
            "shares": (_DIMS, shares),
            "dollars": (_DIMS, dollars),
            "weight": (_DIMS, weight),
        },
        coords={
            "report_date": report_dates,
            "available_date": avail_dates,
            "ticker": list(tickers),
        },
    )
    return ds.assign_coords(cik=cik)


def holdings_from_filing(
    cik: str,
    report_date: str,
    available_date: str,
    holdings_rows: list[dict],
) -> xr.Dataset:
    """Build the bi-temporal Dataset from ONE live ``get_filer_holdings`` filing.

    The live SDK (0.3.10) returns only the filer's *latest* disclosed snapshot, so
    this produces a single-filing Dataset — one populated diagonal cell — with the
    same dims/vars as :func:`make_mock_holdings`, letting :func:`as_of_snapshot`
    and everything downstream treat mock and live data identically. Multiple
    vintages can be concatenated on the paired date dims once the API exposes
    historical holdings.

    Positions are keyed by ``ticker`` (dim) and carry their FIGI ``security_id``
    as a companion coord. No CUSIP is read or stored — identifiers are FIGI only
    (S&P Global proprietary; licensing).

    Args:
        cik: The filer's Central Index Key (scalar coord).
        report_date: Quarter-end the filing represents (ISO string).
        available_date: When the filing became public — the real ``filing_date``
            from the API. This is the ONLY axis :func:`as_of_snapshot` gates on.
        holdings_rows: The envelope's ``holdings`` list. Each row needs at least
            ``ticker``; ``security_id`` (FIGI), ``adj_mv``, ``weight`` are used
            when present.

    Returns:
        A single-filing :class:`xarray.Dataset` with dims ``(report_date,
        available_date, ticker)``, data vars ``shares``/``dollars``/``weight``,
        and coords ``cik`` (scalar) + ``security_id`` (along ``ticker``).
    """
    # Historical vintages can include confidential-treatment rows with a null
    # ticker and a "BW-RESTRICTED" placeholder security_id, so fall back to the
    # security_id (then a positional label) and de-duplicate to keep the ticker
    # coord unique — two restricted lines would otherwise collide.
    security_ids = [r.get("security_id") for r in holdings_rows]
    seen: dict[str, int] = {}
    tickers = []
    for j, r in enumerate(holdings_rows):
        label = r.get("ticker") or r.get("security_id") or f"UNKNOWN_{j}"
        if label in seen:
            seen[label] += 1
            label = f"{label}#{seen[label]}"
        else:
            seen[label] = 0
        tickers.append(label)
    n_t = len(tickers)
    shape = (1, 1, n_t)

    # The API gives market value + weight, not raw share counts.
    shares = np.full(shape, np.nan)
    dollars = np.full(shape, np.nan)
    weight = np.full(shape, np.nan)
    for j, r in enumerate(holdings_rows):
        mv = r.get("adj_mv")
        w = r.get("weight")
        dollars[0, 0, j] = np.nan if mv is None else float(mv)
        weight[0, 0, j] = np.nan if w is None else float(w)

    ds = xr.Dataset(
        {
            "shares": (_DIMS, shares),
            "dollars": (_DIMS, dollars),
            "weight": (_DIMS, weight),
        },
        coords={
            "report_date": pd.to_datetime([report_date]),
            "available_date": pd.to_datetime([available_date]),
            "ticker": list(tickers),
        },
    )
    ds = ds.assign_coords(security_id=("ticker", security_ids))
    return ds.assign_coords(cik=cik)


def as_of_snapshot(
    holdings: xr.Dataset,
    as_of_date: date,
    lag_days: int = 0,
) -> xr.Dataset:
    """Return the most recent snapshot whose ``available_date + lag_days`` ≤ ``as_of_date``.

    Point-in-time safety: NEVER uses ``report_date`` to filter. This is the core
    anti-look-ahead invariant. When no snapshot is yet visible, returns an empty
    Dataset (zero-length ``report_date``/``available_date``, not an error).
    Forward-fill behaviour falls out naturally: between two filings' visibility
    dates the most recent visible snapshot is returned.

    Args:
        holdings: A bi-temporal holdings dataset from
            :func:`make_mock_holdings` or :func:`holdings_from_filing`.
        as_of_date: The query date (the "now" of a back-test).
        lag_days: Days after ``available_date`` before a filing is treated as
            actionable. Default 0 — the live API carries real ``filing_date``
            values, so the Sammon 2016 +45d availability *proxy* is obsolete
            (Conrad, overnight). Pass ``lag_days=45`` to reproduce the proxy
            (the mock-history tests do exactly that to exercise the gate).

    Returns:
        The selected filing as a Dataset reduced to dims ``(ticker,)`` with
        scalar ``report_date`` / ``available_date`` coords, or an empty Dataset
        if no filing is yet actionable.
    """
    as_of_ts = pd.Timestamp(as_of_date)
    avail = pd.to_datetime(holdings["available_date"].values)

    # Visibility gate — the ONLY temporal filter, and it is on available_date.
    actionable = (avail + pd.Timedelta(days=lag_days)) <= as_of_ts
    if not actionable.any():
        return holdings.isel(report_date=slice(0, 0), available_date=slice(0, 0))

    # Most recent visible filing = latest available_date among the actionable.
    idxs = np.where(actionable)[0]
    chosen = int(idxs[np.argmax(avail[idxs].values)])
    # report_date[i] pairs with available_date[i], so isel the same position on
    # both dims to land on that filing's populated diagonal cell.
    return holdings.isel(report_date=chosen, available_date=chosen)


__all__ = ["make_mock_holdings", "holdings_from_filing", "as_of_snapshot"]
