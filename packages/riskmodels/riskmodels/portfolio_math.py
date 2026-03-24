"""Portfolio weights and batch JSON → PortfolioAnalysis."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

import pandas as pd

from .legends import SHORT_ERM3_LEGEND
from .lineage import RiskLineage
from .mapping import normalize_metrics_v3
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


def normalize_positions(positions: Mapping[str, float]) -> dict[str, float]:
    tickers = {str(k).strip().upper(): float(v) for k, v in positions.items()}
    if not tickers:
        raise ValueError("positions is empty")
    s = sum(tickers.values())
    if s <= 0:
        n = len(tickers)
        return {k: 1.0 / n for k in tickers}
    return {k: v / s for k, v in tickers.items()}


def renormalize_weights(weights: dict[str, float], successful: list[str]) -> dict[str, float]:
    ws = {t: weights[t] for t in successful if t in weights}
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
        fm = entry.get("full_metrics")
        if not fm:
            errors[ticker] = "missing full_metrics"
            continue
        row: dict[str, Any] = {"ticker": ticker, "weight": weights.get(ticker, 0.0)}
        for k, v in fm.items():
            if k in ("ticker", "date"):
                row[k] = v
            elif isinstance(v, (int, float)) or v is None:
                row[k] = v
        rows.append(row)
        successful.append(ticker)

        m = {k: fm[k] for k in fm if isinstance(fm[k], (int, float)) or fm[k] is None}
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
                raw = per_ticker.loc[t, hk] if hk in per_ticker.columns else None
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
            raw = per_ticker.loc[t, ek]
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
