"""Portfolio weights and batch JSON → PortfolioAnalysis."""

from __future__ import annotations

import numbers
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd

from .legends import SHORT_ERM3_LEGEND
from .lineage import RiskLineage
from .mapping import (
    merge_batch_hedge_ratios_into_full_metrics,
    normalize_metrics_v3,
    omit_nan_float_fields,
)
from .metadata_attach import attach_sdk_metadata
from .parsing import batch_returns_long_normalize
from .validation import RiskModelsValidationIssue, ValidateMode, run_validation

PORTFOLIO_HR_KEYS = [
    "l1_market_hr",
    "l2_market_hr",
    "l2_sector_hr",
    "l3_market_hr",
    "l3_sector_hr",
    "l3_subsector_hr",
]

PORTFOLIO_L3_ER_KEYS = [
    "l3_market_er",
    "l3_sector_er",
    "l3_subsector_er",
    "l3_residual_er",
]


def _is_metric_scalar(v: Any) -> bool:
    """True for JSON / numpy scalars we should keep on per-ticker rows (exclude bool)."""
    if v is None:
        return True
    if isinstance(v, bool):
        return False
    if isinstance(v, (int, float)):
        return True
    if isinstance(v, numbers.Real):
        return True
    try:
        import numpy as np

        return isinstance(v, (np.floating, np.integer))
    except ImportError:
        return False


def _df_scalar(df: pd.DataFrame, idx: str, col: str) -> Any:
    """Single cell; duplicate index returns first row."""
    if col not in df.columns or idx not in df.index:
        return None
    raw = df.loc[idx, col]
    if isinstance(raw, pd.Series):
        raw = raw.iloc[0]
    return raw


PositionsInput = Mapping[str, float] | Sequence[Mapping[str, Any] | tuple[str, float]]


def normalize_positions(positions: Mapping[str, float]) -> dict[str, float]:
    tickers = {str(k).strip().upper(): float(v) for k, v in positions.items()}
    if not tickers:
        raise ValueError("positions is empty")
    s = sum(tickers.values())
    if s <= 0:
        n = len(tickers)
        return {k: 1.0 / n for k in tickers}
    return {k: v / s for k, v in tickers.items()}


def positions_to_weights(positions: PositionsInput) -> dict[str, float]:
    """Accept ``{TICKER: weight}``, ``[{"ticker","weight"}, ...]``, or ``[("AAPL", 0.5), ...]`` and normalize."""
    if isinstance(positions, Mapping):
        return normalize_positions(positions)
    out: dict[str, float] = {}
    for p in positions:
        if isinstance(p, Mapping):
            t = str(p.get("ticker", "")).strip().upper()
            if not t:
                raise ValueError("position entry missing ticker")
            out[t] = float(p["weight"])
        elif isinstance(p, tuple) and len(p) == 2:
            out[str(p[0]).strip().upper()] = float(p[1])
        else:
            raise TypeError("Each position must be a mapping with ticker and weight, or a (ticker, weight) tuple")
    return normalize_positions(out)


def renormalize_weights(weights: dict[str, float], successful: list[str]) -> dict[str, float]:
    """Intersect portfolio weights with successful batch tickers; renormalize to sum 1.

    If none of `successful` appear in `weights` (symbol mismatch), fall back to equal
    weights over `successful` so portfolio HR aggregation still runs.
    """
    ws = {t: weights[t] for t in successful if t in weights}
    if not ws:
        if not successful:
            return {}
        n = len(successful)
        return {t: 1.0 / n for t in successful}
    s = sum(ws.values())
    if s <= 0:
        n = len(ws)
        return {t: 1.0 / n for t in ws}
    return {t: v / s for t, v in ws.items()}


def returns_payload_to_rows(ticker: str, payload: Mapping[str, Any]) -> list[dict[str, Any]]:
    dates = payload.get("dates") or []
    values = payload.get("values") or []
    l1 = payload.get("l1") or []
    l2 = payload.get("l2") or []
    l3 = payload.get("l3") or []
    rows: list[dict[str, Any]] = []
    for i, d in enumerate(dates):
        rows.append(
            {
                "ticker": ticker,
                "date": d,
                "gross_return": values[i] if i < len(values) else None,
                "l1": l1[i] if i < len(l1) else None,
                "l2": l2[i] if i < len(l2) else None,
                "l3": l3[i] if i < len(l3) else None,
            }
        )
    return rows


def batch_json_to_returns_long(results: Mapping[str, Any]) -> pd.DataFrame | None:
    rows: list[dict[str, Any]] = []
    for tkey, entry in results.items():
        if not isinstance(entry, dict) or entry.get("status") != "success":
            continue
        ret = entry.get("returns")
        if not ret:
            continue
        tk = entry.get("ticker") or tkey
        rows.extend(returns_payload_to_rows(str(tk).upper(), ret))
    if not rows:
        return None
    df = pd.DataFrame(rows)
    return batch_returns_long_normalize(df)


@dataclass
class PortfolioAnalysis:
    lineage: RiskLineage
    per_ticker: pd.DataFrame
    portfolio_hedge_ratios: dict[str, float | None]
    portfolio_l3_er_weighted_mean: dict[str, float | None]
    weights: dict[str, float]
    errors: dict[str, str]
    returns_long: pd.DataFrame | None = None
    panel: Any = None  # xarray.Dataset when [xarray] + include_returns_panel
    issues: list[RiskModelsValidationIssue] = field(default_factory=list)
    legend: str = SHORT_ERM3_LEGEND

    def to_llm_context(self, *, include_lineage: bool = True) -> str:
        from .llm import to_llm_context

        return to_llm_context(self, include_lineage=include_lineage)

    def to_xarray(self) -> Any:
        from .xarray_convert import long_df_to_dataset

        if self.returns_long is None or self.returns_long.empty:
            raise ValueError("No returns_long panel; request returns in analyze_portfolio.")
        return long_df_to_dataset(self.returns_long, self.lineage)

    def summary_dict(self) -> dict[str, Any]:
        """Flatten portfolio-level aggregates into one dict row."""
        row: dict[str, Any] = {"ticker": "PORTFOLIO"}
        if self.portfolio_hedge_ratios:
            row.update(self.portfolio_hedge_ratios)
        if self.portfolio_l3_er_weighted_mean:
            row.update(self.portfolio_l3_er_weighted_mean)
        return row

    def to_dataframe(self, include_summary: bool = True) -> pd.DataFrame:
        """Per-ticker DataFrame, optionally with portfolio summary row appended."""
        df = self.per_ticker.copy()
        if include_summary:
            df = pd.concat([df, pd.DataFrame([self.summary_dict()])], ignore_index=True)
        return df

    def to_csv(self, path: str | Path | None = None, include_summary: bool = True) -> str | None:
        """Write to CSV file or return CSV string if path is None."""
        df = self.to_dataframe(include_summary=include_summary)
        if path is not None:
            df.to_csv(path, index=False)
            return None
        return df.to_csv(index=False)


def analyze_batch_to_portfolio(
    batch_body: dict[str, Any],
    weights: dict[str, float],
    *,
    validate: ValidateMode = "warn",
    er_tolerance: float = 0.05,
    include_returns_long: bool = False,
    response_lineage: RiskLineage | None = None,
) -> PortfolioAnalysis:
    results = batch_body.get("results") or {}
    meta = batch_body.get("_metadata")
    lineage = RiskLineage.from_metadata(meta) if meta else RiskLineage()
    lineage = RiskLineage.merge(response_lineage, lineage)

    errors: dict[str, str] = {}
    rows: list[dict[str, Any]] = []
    successful: list[str] = []
    collected_issues: list[RiskModelsValidationIssue] = []

    for tkey, entry in results.items():
        if not isinstance(entry, dict):
            continue
        ticker = str(entry.get("ticker") or tkey).upper()
        if entry.get("status") != "success":
            errors[ticker] = str(entry.get("error") or "error")
            continue
        raw_fm = entry.get("full_metrics")
        if raw_fm is None:
            errors[ticker] = "missing full_metrics"
            continue
        # Batch often puts HRs under `hedge_ratios` (short keys); merge before normalize.
        fm_merged = merge_batch_hedge_ratios_into_full_metrics(
            dict(raw_fm),
            entry.get("hedge_ratios"),
        )
        fm_merged = omit_nan_float_fields(fm_merged)
        # Wire keys (l3_mkt_er, …) → semantic names so ER/HR validation matches GET /metrics.
        fm_norm = normalize_metrics_v3(dict(fm_merged))
        row: dict[str, Any] = {"ticker": ticker, "weight": weights.get(ticker, 0.0)}
        for k, v in fm_norm.items():
            if k in ("ticker", "date"):
                row[k] = v
            elif _is_metric_scalar(v):
                row[k] = v
        rows.append(row)
        successful.append(ticker)

        m = {k: fm_norm[k] for k in fm_norm if _is_metric_scalar(fm_norm[k])}
        collected_issues.extend(run_validation(m, mode=validate, er_tolerance=er_tolerance))

    w_eff = renormalize_weights(weights, successful)
    per_ticker = pd.DataFrame(rows)
    if not per_ticker.empty:
        per_ticker = per_ticker.set_index("ticker", drop=False)
        for t in successful:
            per_ticker.loc[t, "weight"] = w_eff.get(t, 0.0)

    phr: dict[str, float | None] = {}
    for hk in PORTFOLIO_HR_KEYS:
        num = 0.0
        den = 0.0
        for t in successful:
            v = None
            if not per_ticker.empty and t in per_ticker.index:
                raw = _df_scalar(per_ticker, t, hk)
                v = float(raw) if raw is not None and pd.notna(raw) else None
            if v is None:
                continue
            w = w_eff.get(t, 0.0)
            num += w * v
            den += w
        phr[hk] = (num / den) if den > 0 else None

    per_er: dict[str, float | None] = {}
    for ek in PORTFOLIO_L3_ER_KEYS:
        num = 0.0
        den = 0.0
        for t in successful:
            if per_ticker.empty or t not in per_ticker.index or ek not in per_ticker.columns:
                continue
            raw = _df_scalar(per_ticker, t, ek)
            if raw is None or pd.isna(raw):
                continue
            w = w_eff.get(t, 0.0)
            num += w * float(raw)
            den += w
        per_er[ek] = (num / den) if den > 0 else None

    returns_long = batch_json_to_returns_long(results) if include_returns_long else None
    panel = None

    attach_sdk_metadata(per_ticker, lineage, kind="portfolio_per_ticker")
    if returns_long is not None:
        attach_sdk_metadata(returns_long, lineage, kind="batch_returns_long")

    return PortfolioAnalysis(
        lineage=lineage,
        per_ticker=per_ticker,
        portfolio_hedge_ratios=phr,
        portfolio_l3_er_weighted_mean=per_er,
        weights=w_eff,
        errors=errors,
        returns_long=returns_long,
        panel=panel,
        issues=collected_issues,
    )


def metrics_body_to_row(body: dict[str, Any]) -> dict[str, Any]:
    m = body.get("metrics") or {}
    row = normalize_metrics_v3(dict(m))
    row["ticker"] = body.get("ticker") or body.get("symbol")
    row["teo"] = body.get("teo")
    return row
