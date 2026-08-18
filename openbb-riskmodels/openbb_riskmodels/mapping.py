"""Pure mapping from riskmodels-py payloads to OpenBB command results.

No OpenBB imports. Canonical field names stay those of the SDK / REST API.
"""

from __future__ import annotations

from typing import Any

# Mirrors riskmodels.fundamentals.FUNDAMENTALS_ROW_COLUMNS. Duplicated here so
# the OpenBB row contract is explicit and mapping tests do not import the SDK.
FUNDAMENTALS_ROW_COLUMNS: tuple[str, ...] = (
    "period_end_date",
    "filed_date",
    "filed_date_source",
    "sec_facts",
    "gross_margin",
    "operating_margin",
    "roe_ttm",
    "roa_ttm",
    "leverage_ratio",
    "fcf_margin",
    "payout_ratio",
    "retention_ratio",
    "buyback_ratio",
    "total_payout_ratio",
    "sustainable_growth",
    "equity_bridge_residual",
    "equity_bridge_inputs",
    "beta_market",
    "beta_sector",
    "beta_subsector",
    "beta_source",
    "rf_rate",
    "cost_of_equity",
    "cost_of_debt",
    "wacc",
    "economic_profit",
    "market_cap",
)

_LAYERS = ("market", "sector", "subsector", "residual")
_V4_BLOCKS = ("style", "stock_specific")


def map_decompose(payload: dict[str, Any]) -> dict[str, Any]:
    """Flatten ``client.decompose()`` JSON into one OpenBB result dict."""
    exposure = payload.get("exposure") or {}
    hedge_levels = payload.get("hedge_levels") or {}
    result: dict[str, Any] = {
        "ticker": payload.get("ticker"),
        "data_as_of": payload.get("data_as_of") or payload.get("teo"),
        "hedge_map": payload.get("hedge") or {},
        "recommended_hedge_level": hedge_levels.get("recommended_level"),
    }
    for name in _LAYERS:
        block = exposure.get(name) or {}
        result[name] = {
            "er": _clean(block.get("er")),
            "hr": _clean(block.get("hr")),
            "hedge_etf": block.get("hedge_etf"),
        }
    for name in _V4_BLOCKS:
        block = payload.get(name)
        if isinstance(block, dict):
            result[name] = {
                "explained_variance": _clean(block.get("explained_variance")),
                "hedgeable": bool(block.get("hedgeable", False)),
            }
    return result


def map_decompose_historical(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One row per model date from ``client.get_l3_decomposition()`` records."""
    rows: list[dict[str, Any]] = []
    for rec in records:
        rows.append(
            {
                "date": _date(rec.get("date")),
                "market_er": _clean(rec.get("l3_market_er")),
                "sector_er": _clean(rec.get("l3_sector_er")),
                "subsector_er": _clean(rec.get("l3_subsector_er")),
                "residual_er": _clean(rec.get("l3_residual_er")),
                "market_hr": _clean(rec.get("l3_market_hr")),
                "sector_hr": _clean(rec.get("l3_sector_hr")),
                "subsector_hr": _clean(rec.get("l3_subsector_hr")),
            }
        )
    return rows


def map_fundamentals(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One row per quarter from ``client.get_fundamentals(..., as_dataframe=True)``."""
    rows: list[dict[str, Any]] = []
    for rec in records:
        row = {col: _clean(rec.get(col)) for col in FUNDAMENTALS_ROW_COLUMNS}
        row["period_end_date"] = _date(row.get("period_end_date"))
        row["filed_date"] = _date(row.get("filed_date"))
        rows.append(row)
    return rows


def _date(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() == "nat":
        return None
    return text[:10]


def _clean(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, float) and value != value:
        return None
    if isinstance(value, dict):
        return {str(k): _clean(v) for k, v in value.items()}
    if hasattr(value, "item") and not isinstance(value, (bytes, str, dict)):
        try:
            value = value.item()
        except (ValueError, AttributeError):
            pass
        if isinstance(value, float) and value != value:
            return None
    return value
