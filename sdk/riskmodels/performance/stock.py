"""Stock performance namespace (current / historical)."""

from __future__ import annotations

from typing import Any

import pandas as pd

from ..lineage import RiskLineage
from ..mapping import merge_batch_hedge_ratios_into_full_metrics, normalize_metrics_v3, omit_nan_float_fields
from .base import PerformanceResult


def _row_from_batch_entry(entry: dict[str, Any]) -> dict[str, Any]:
    raw = entry.get("full_metrics")
    if not isinstance(raw, dict):
        return {}
    merged = merge_batch_hedge_ratios_into_full_metrics(dict(raw), entry.get("hedge_ratios"))
    merged = omit_nan_float_fields(merged)
    norm = normalize_metrics_v3(merged)
    t = entry.get("ticker")
    if t:
        norm["ticker"] = str(t).upper()
    meta = entry.get("meta")
    if isinstance(meta, dict):
        for mk in ("sector_etf", "subsector_etf", "subsector_etf_symbol", "market_etf"):
            v = meta.get(mk)
            if v and mk not in norm:
                norm[mk] = v
    return norm


def _maybe_fill_vol_from_returns(row: dict[str, Any], entry: dict[str, Any]) -> None:
    """If snapshot vol is missing, estimate 23d ann. vol from batch ``returns.values``."""
    from ..visuals.utils import annualized_vol_decimal, annualized_vol_from_returns_values

    if annualized_vol_decimal(row) is not None:
        return
    ret = entry.get("returns")
    if not isinstance(ret, dict):
        return
    est = annualized_vol_from_returns_values(ret.get("values"))
    if est is not None and est > 0:
        row["vol_23d"] = est
        row["volatility"] = est


class StockCurrent:
    def __init__(self, client: Any) -> None:
        self._client = client

    def data(self, ticker: str, *, as_dataframe: bool = True, **kwargs: Any) -> Any:
        return self._client.get_metrics(ticker, as_dataframe=as_dataframe, **kwargs)

    def plot(
        self,
        *,
        style: str = "l3_decomposition",
        sigma_scaled: bool = True,
        ticker: str | None = None,
        tickers: list[str] | None = None,
        years: int = 1,
        **kwargs: Any,
    ) -> Any:
        if style != "l3_decomposition":
            raise ValueError(f"Unsupported stock plot style: {style}")
        if ticker and tickers:
            tickers = None
        if ticker:
            tickers_use = [ticker]
        elif tickers:
            tickers_use = list(tickers)
        else:
            raise ValueError("Provide ticker or tickers")

        rows, lineage = self._metric_rows_for_tickers(
            [str(t).strip().upper() for t in tickers_use],
            years=years,
            fill_sigma_from_returns=sigma_scaled,
        )
        from ..visuals.l3_decomposition import plot_l3_horizontal

        plot_kw = {
            k: v
            for k, v in kwargs.items()
            if k
            in {
                "metadata",
                "title",
                "subtitle",
                "annotation_mode",
                "style_preset",
                "annotation_formatter",
                "tuple_from_row",
                "theme",
            }
        }
        return plot_l3_horizontal(
            rows,
            sigma_scaled=sigma_scaled,
            lineage=lineage,
            **plot_kw,
        )

    def pdf(self, ticker: str) -> bytes:
        data, _ = self._client.get_metrics_snapshot_pdf(ticker)
        return data

    def _metric_rows_for_tickers(
        self,
        tickers: list[str],
        *,
        years: int,
        fill_sigma_from_returns: bool = False,
    ) -> tuple[list[dict[str, Any]], RiskLineage]:
        mlist = ["full_metrics", "hedge_ratios"]
        if fill_sigma_from_returns:
            mlist.append("returns")
        body, lineage = self._client.batch_analyze(
            tickers,
            mlist,
            years=years,
            format="json",
            return_lineage=True,
        )
        if not isinstance(body, dict):
            raise TypeError("Expected JSON batch body")
        rows: list[dict[str, Any]] = []
        results = body.get("results") or {}
        for _k, entry in results.items():
            if not isinstance(entry, dict) or entry.get("status") != "success":
                continue
            row = _row_from_batch_entry(entry)
            if row:
                if fill_sigma_from_returns:
                    _maybe_fill_vol_from_returns(row, entry)
                rows.append(row)
        # Preserve requested order
        by_t = {r["ticker"]: r for r in rows if "ticker" in r}
        ordered = [by_t[t] for t in tickers if t in by_t]
        return ordered, lineage


class StockHistorical:
    """Placeholder for time-series stock analytics (future)."""

    def __init__(self, client: Any) -> None:
        self._client = client

    def data(self, ticker: str, **kwargs: Any) -> pd.DataFrame:
        return self._client.get_ticker_returns(ticker, **kwargs)


class StockNamespace:
    def __init__(self, client: Any) -> None:
        self._client = client
        self.current = StockCurrent(client)
        self.historical = StockHistorical(client)

    def performance_result(
        self,
        ticker: str,
        *,
        as_dataframe: bool = True,
        **kwargs: Any,
    ) -> PerformanceResult:
        df = self._client.get_metrics(ticker, as_dataframe=True, **kwargs)
        lin = RiskLineage()
        raw = df.attrs.get("riskmodels_lineage") if hasattr(df, "attrs") else None
        if raw:
            import json

            try:
                lin = RiskLineage(**json.loads(raw))
            except Exception:
                pass
        return PerformanceResult(lineage=lin, kind="stock", stock_metrics=df)
