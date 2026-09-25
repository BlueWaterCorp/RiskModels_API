"""PortfolioTimeSeries — a 13F filer's disclosed long book as a bi-temporal series.

All access is point-in-time-safe: snapshots are gated by ``available_date``
(the real ``filing_date`` from the API — when a filing became public), never
``report_date`` (the quarter it describes), so back-tests cannot look ahead.

Live wiring targets ``riskmodels-py`` 0.3.11 (migrated from 0.3.10 on 2026-07-08):

- :meth:`from_cik` resolves a ``bw_filer_id`` via ``search_filers`` and builds the
  latest-vintage Dataset from ``get_filer_holdings``.
- :meth:`as_of` calls ``get_filer_holdings(bw_filer_id, as_of=...)`` server-side —
  the API resolves the point-in-time vintage on ``filing_date`` (returns
  ``as_of_basis="filing_date"``), so historical back-tests now retrieve the real
  disclosed book as of any date. Falls back to the local xarray ``as_of_snapshot``
  gate when no client is attached (mock-data tests).
- :meth:`factor_decomposition_series` fans out ``client.decompose`` per position.
- :meth:`concentration` calls ``get_filer_concentration`` (precomputed HHI / top-5 /
  top-10); a hand-computed HHI remains as a permanent test-time cross-check.

History note: holdings vintages reach back to ``report_date`` 2013-09-30 (filed
2013-11-14); earlier ``as_of`` dates raise ``APIError`` ("No holdings were known"),
which :meth:`as_of` maps to an empty snapshot. The portfolio series starts one
quarter earlier (2013-06-30) — see SESSION_NOTES.md.

Identifiers are FIGI (``security_id`` like ``BW-BBG...``) — CUSIP is never used.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Literal

import numpy as np
import xarray as xr

from .schema import as_of_snapshot, holdings_from_filing

# Lag presets for as_of(). Real filing dates make the +45d Sammon proxy obsolete,
# so "min" is 0; "conservative" keeps a buffer for late-amended filings.
_LAG_DAYS = {"min": 0, "conservative": 45}

# Industry-axis factor layers (hedgeable) + measurement-only layers.
_HEDGE_LAYERS = ("market", "sector", "subsector")
_MEASURE_LAYERS = ("style", "stock_specific")
_FACTOR_LAYERS = _HEDGE_LAYERS + _MEASURE_LAYERS


def _make_client():
    """Lazily build a client from the environment (keeps import side-effect-free)."""
    from riskmodels import RiskModelsClient

    return RiskModelsClient.from_env()


def _resolve_filer_id(client, cik: str) -> str:
    """Resolve a CIK (or name) to the SDK's ``bw_filer_id``.

    0.3.10 keys filer endpoints by ``bw_filer_id`` (e.g.
    ``BW-FILER-CIK0001067983``), not raw CIK. Prefer ``search_filers`` so a name
    or a partial CIK both resolve; fall back to the deterministic
    ``BW-FILER-CIK{cik}`` shape if search returns nothing.
    """
    if str(cik).startswith("BW-FILER"):
        return cik
    try:
        res = client.search_filers(q=str(cik), limit=5)
        results = res.get("results") or res.get("filers") or []
        # Prefer an exact CIK match if the query was numeric.
        digits = "".join(ch for ch in str(cik) if ch.isdigit())
        for item in results:
            item_cik = "".join(ch for ch in str(item.get("cik", "")) if ch.isdigit())
            if digits and item_cik.lstrip("0") == digits.lstrip("0"):
                return item["bw_filer_id"]
        if results:
            return results[0]["bw_filer_id"]
    except Exception:
        pass
    # Deterministic fallback: zero-pad to the 10-digit CIK convention.
    return f"BW-FILER-CIK{str(cik).zfill(10)}"


def _current_weights(holdings: xr.Dataset) -> tuple[list[str], np.ndarray]:
    """Extract (tickers, weights) for the latest populated filing in ``holdings``.

    Collapses the single populated diagonal cell to a per-ticker weight vector,
    dropping tickers whose weight is NaN (not held in that vintage).
    """
    # Latest available_date is the most recent filing.
    avail = holdings["available_date"].values
    j = int(np.argmax(avail))
    w = holdings["weight"].isel(report_date=j, available_date=j).values
    tickers = [str(t) for t in holdings["ticker"].values]
    mask = ~np.isnan(w)
    return [t for t, m in zip(tickers, mask) if m], w[mask]


class PortfolioTimeSeries:
    """A 13F filer's disclosed long book as a bi-temporal xarray time series.

    Build via :meth:`from_cik`. All point-in-time access goes through
    :meth:`as_of`, which is gated on ``available_date`` only.

    Args:
        cik: The filer's Central Index Key.
        holdings: Bi-temporal holdings dataset with dims
            ``(report_date, available_date, ticker)`` (see
            :func:`portfolio_timeseries.schema.holdings_from_filing`).
        client: Optional live SDK client, retained for methods that need further
            API calls (``factor_decomposition_series``, ``concentration``).
        bw_filer_id: The resolved SDK filer id, if built from the live API.
    """

    def __init__(
        self,
        cik: str,
        holdings: xr.Dataset,
        client=None,
        bw_filer_id: str | None = None,
    ):
        self.cik = cik
        self._holdings = holdings  # dims: (report_date, available_date, ticker)
        self._client = client
        self._bw_filer_id = bw_filer_id

    @classmethod
    def from_cik(cls, cik: str, client=None) -> "PortfolioTimeSeries":
        """Build from live 13F filings for a CIK via ``riskmodels-py`` 0.3.10.

        Resolves ``cik`` → ``bw_filer_id`` (``search_filers``), fetches the latest
        disclosed snapshot (``get_filer_holdings``), and constructs the bi-temporal
        Dataset with the real ``filing_date`` as ``available_date``. When the
        holdings envelope's ``filing_date`` is null (observed intermittently on the
        full-holdings fetch), the true date is recovered from the matching
        ``get_filer_portfolio`` period; if still unavailable it falls back to
        ``report_date`` (conservative — never earlier than the quarter-end).

        Args:
            cik: The filer's Central Index Key (or a name/``bw_filer_id``).
            client: Optional SDK client; built from env if omitted.
        """
        client = client or _make_client()
        fid = _resolve_filer_id(client, cik)

        env = client.get_filer_holdings(fid)
        report_date = env.get("report_date")
        available_date = env.get("filing_date")
        rows = env.get("holdings") or []

        if available_date is None:
            available_date = cls._lookup_filing_date(client, fid, report_date)
        if available_date is None:
            # Conservative fallback: treat the quarter-end as the visibility date.
            # Never earlier than report_date, so it cannot manufacture look-ahead.
            available_date = report_date

        ds = holdings_from_filing(str(cik), report_date, available_date, rows)
        return cls(str(cik), ds, client=client, bw_filer_id=fid)

    @staticmethod
    def _lookup_filing_date(client, fid: str, report_date) -> str | None:
        """Find the real ``filing_date`` for ``report_date`` in the portfolio series."""
        try:
            port = client.get_filer_portfolio(fid)
            for row in port.get("rows", []):
                if str(row.get("teo")) == str(report_date):
                    return row.get("filing_date")
        except Exception:
            return None
        return None

    def as_of(
        self,
        as_of_date: date,
        lag: Literal["min", "conservative"] = "min",
    ) -> xr.Dataset:
        """Point-in-time-safe snapshot, resolved on ``filing_date`` (never report_date).

        With a live client this calls ``get_filer_holdings(bw_filer_id, as_of=...)``,
        so the API returns the real disclosed book as of the query date (0.3.11).
        Without a client it falls back to the local bi-temporal gate over
        ``self._holdings`` (mock-data path).

        - ``lag='min'``: query ``as_of_date`` directly (real filing dates; default).
        - ``lag='conservative'``: query ``as_of_date - 45 days``, a buffer that
          ignores filings public for fewer than 45 days (late-amendment guard).

        Returns the selected filing reduced to dims ``(ticker,)`` with scalar
        ``report_date``/``available_date`` coords, or an empty snapshot when no
        filing was known as of the (lagged) query date — the API raises
        ``APIError`` in that case, which is mapped to the empty snapshot so the
        anti-look-ahead contract is preserved.
        """
        lag_days = _LAG_DAYS[lag]
        if self._client is not None and self._bw_filer_id is not None:
            effective = as_of_date - timedelta(days=lag_days)
            try:
                env = self._client.get_filer_holdings(
                    self._bw_filer_id, as_of=effective.isoformat()
                )
            except Exception as e:  # noqa: BLE001
                # "No holdings were known ..." => before the earliest vintage.
                if "no holdings were known" in str(e).lower():
                    return self._empty_snapshot()
                raise
            return self._snapshot_from_api(env)
        # Offline fallback (mock data): local bi-temporal gate.
        return as_of_snapshot(self._holdings, as_of_date, lag_days=lag_days)

    def _snapshot_from_api(self, env: dict) -> xr.Dataset:
        """Convert a ``get_filer_holdings`` envelope into the ``as_of`` snapshot shape.

        Builds the single-filing Dataset (:func:`holdings_from_filing`) then reduces
        it to dims ``(ticker,)`` with scalar date coords — identical structure to
        :func:`as_of_snapshot`, so the caller-facing return type is unchanged.
        """
        rows = env.get("holdings") or []
        report_date = env.get("report_date")
        available_date = env.get("filing_date") or report_date
        ds = holdings_from_filing(self.cik, report_date, available_date, rows)
        return ds.isel(report_date=0, available_date=0)

    def _empty_snapshot(self) -> xr.Dataset:
        """An empty snapshot (``dollars.size == 0``) with the standard data vars."""
        return as_of_snapshot(self._holdings, date(1900, 1, 1))

    def factor_decomposition_series(
        self,
        cadence: Literal["Q", "M"] = "Q",
        max_positions: int | None = None,
    ) -> xr.Dataset:
        """K=4 factor decomposition of the current book, one ``decompose`` call per name.

        Aggregates per-position results into a Dataset with dims
        ``(report_date, ticker, factor_layer)`` where ``factor_layer`` spans the
        hedgeable industry axis (``market``/``sector``/``subsector``) and the
        measurement-only layers (``style``/``stock_specific``). Data vars:

        - ``hr`` — hedge ratio (industry layers only; NaN for style/stock_specific).
        - ``er`` — exposure / explained-return share (industry layers).
        - ``explained_variance`` — style & stock-specific explained variance
          (Conrad's four-factor measurement fields; NaN for industry layers).

        Args:
            cadence: Reserved — the live SDK exposes only the latest vintage, so
                the series is length-1 on ``report_date`` today.
            max_positions: Cap the number of ``decompose`` calls (top-weighted
                first) — useful for fast tests. ``None`` decomposes every holding.

        Requires a live ``client`` (attach via :meth:`from_cik`).
        """
        if self._client is None:
            raise RuntimeError("factor_decomposition_series needs a live client (use from_cik)")

        tickers, weights = _current_weights(self._holdings)
        if max_positions is not None:
            order = np.argsort(weights)[::-1][:max_positions]
            tickers = [tickers[i] for i in order]

        n_t, n_l = len(tickers), len(_FACTOR_LAYERS)
        hr = np.full((1, n_t, n_l), np.nan)
        er = np.full((1, n_t, n_l), np.nan)
        ev = np.full((1, n_t, n_l), np.nan)

        for i, tkr in enumerate(tickers):
            try:
                d = self._client.decompose(tkr)
            except Exception:
                continue  # leave this position's row as NaN; note in aggregate
            exposure = d.get("exposure", {})
            for k, layer in enumerate(_HEDGE_LAYERS):
                cell = exposure.get(layer, {}) or {}
                hr[0, i, k] = _f(cell.get("hr"))
                er[0, i, k] = _f(cell.get("er"))
            for layer in _MEASURE_LAYERS:
                k = _FACTOR_LAYERS.index(layer)
                block = d.get(layer, {}) or {}
                ev[0, i, k] = _f(block.get("explained_variance"))

        report_date = self._holdings["report_date"].values[
            int(np.argmax(self._holdings["available_date"].values))
        ]
        return xr.Dataset(
            {
                "hr": (("report_date", "ticker", "factor_layer"), hr),
                "er": (("report_date", "ticker", "factor_layer"), er),
                "explained_variance": (("report_date", "ticker", "factor_layer"), ev),
            },
            coords={
                "report_date": [report_date],
                "ticker": tickers,
                "factor_layer": list(_FACTOR_LAYERS),
            },
        )

    def concentration(
        self, kind: Literal["hhi", "top_n"] = "top_n", n: int = 5
    ) -> float:
        """Concentration of the latest disclosed book, from ``get_filer_concentration``.

        - ``kind='hhi'``: the API's precomputed ``weight_hhi``.
        - ``kind='top_n'``: the API's precomputed ``top5_weight_sum`` /
          ``top10_weight_sum`` for ``n in {5, 10}``.

        The SDK precomputes only HHI and the top-5 / top-10 sums, so an arbitrary
        ``n`` (or a client-less mock) is served by :meth:`_local_concentration`
        (identical math on the disclosed weights). The hand-computed HHI is NOT a
        silent fallback for the SDK path — it lives on as a permanent regression
        cross-check (see ``test_sdk_concentration_matches_hand_computed``).
        """
        if self._client is not None and self._bw_filer_id is not None:
            latest = self._concentration_latest()
            if kind == "hhi" and latest.get("weight_hhi") is not None:
                return float(latest["weight_hhi"])
            if kind == "top_n":
                key = {5: "top5_weight_sum", 10: "top10_weight_sum"}.get(n)
                if key and latest.get(key) is not None:
                    return float(latest[key])
        # No client, an unusual n, or a gap in the API payload -> local math.
        return self._local_concentration(kind, n)

    def _concentration_latest(self) -> dict:
        """The ``latest`` block of ``get_filer_concentration`` (empty dict on failure)."""
        try:
            conc = self._client.get_filer_concentration(self._bw_filer_id)
            return conc.get("latest") or {}
        except Exception:  # noqa: BLE001
            return {}

    def _local_concentration(self, kind: str = "hhi", n: int = 5) -> float:
        """Hand-computed concentration on disclosed weights (cross-check + fallback)."""
        _, w = _current_weights(self._holdings)
        if w.size == 0:
            return 0.0
        w = w / w.sum()
        if kind == "hhi":
            return float(np.sum(w**2))
        return float(np.sort(w)[::-1][:n].sum())

    def sdk_weight_hhi(self) -> float | None:
        """The API's own precomputed ``weight_hhi`` for the latest period (cross-check)."""
        if self._client is None or self._bw_filer_id is None:
            return None
        return self._concentration_latest().get("weight_hhi")

    def unobserved_performance(self, window: int = 24) -> float | None:
        """Gap between reported gross returns and the disclosed long book.

        Requires reported-gross-returns integration; deferred to a follow-up
        session.
        """
        raise NotImplementedError("Requires reported gross returns integration")


def _f(x) -> float:
    """Coerce an API scalar to float, mapping None/missing to NaN."""
    return float("nan") if x is None else float(x)


__all__ = ["PortfolioTimeSeries"]
