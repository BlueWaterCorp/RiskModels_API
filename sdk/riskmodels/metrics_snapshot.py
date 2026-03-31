"""Human-readable text snapshot for `get_metrics` dict rows (ERM3 L3 fields)."""

from __future__ import annotations

from typing import Any

_L3_HR_ROWS: tuple[tuple[str, str], ...] = (
    ("l3_market_hr", "L3 market HR (SPY / $1 stock)"),
    ("l3_sector_hr", "L3 sector HR"),
    ("l3_subsector_hr", "L3 subsector HR"),
)
_L3_ER_ROWS: tuple[tuple[str, str], ...] = (
    ("l3_market_er", "L3 market ER"),
    ("l3_sector_er", "L3 sector ER"),
    ("l3_subsector_er", "L3 subsector ER"),
    ("l3_residual_er", "L3 residual ER"),
)
_MARKET_ROWS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("vol_23d", "Vol (23d ann.)", ("vol_23d", "volatility")),
    ("price_close", "Last close", ("price_close", "close_price")),
    ("market_cap", "Market cap", ("market_cap",)),
)


def _fmt_val(v: Any) -> str:
    if v is None:
        return "—"
    if isinstance(v, bool):
        return str(v)
    if isinstance(v, float):
        return f"{v:.6g}"
    return str(v)


def _pick(row: dict[str, Any], *keys: str) -> Any:
    for k in keys:
        if k in row and row[k] is not None:
            return row[k]
    return None


def format_metrics_snapshot(row: dict[str, Any]) -> str:
    """
    Build a human-readable block for terminal/notebook output from a `get_metrics` row dict.

    Expects semantic keys after `metrics_body_to_row` / `normalize_metrics_v3` (see `riskmodels.mapping`).
    """
    lines: list[str] = []
    ticker = row.get("ticker") or row.get("symbol", "?")
    teo = row.get("teo", "?")
    lines.append(f"RiskModels snapshot — {ticker}  (as-of {teo})")
    lines.append("")

    lines.append("L3 hedge ratios (USD of ETF per $1 of stock)")
    for key, label in _L3_HR_ROWS:
        if key in row:
            lines.append(f"  {label:32}  {_fmt_val(row.get(key))}")

    lines.append("")
    lines.append("L3 explained risk (variance shares, 0–1)")
    for key, label in _L3_ER_ROWS:
        if key in row:
            lines.append(f"  {label:32}  {_fmt_val(row.get(key))}")

    market_any = any(_pick(row, *keys) is not None for _, _, keys in _MARKET_ROWS)
    if market_any:
        lines.append("")
        lines.append("Market")
        for _, label, keys in _MARKET_ROWS:
            v = _pick(row, *keys)
            if v is not None:
                lines.append(f"  {label:32}  {_fmt_val(v)}")

    lines.append("")
    lines.append("—")
    lines.append("ERM3 legend (see SDK docs for full detail)")
    from .legends import SHORT_ERM3_LEGEND

    lines.append(SHORT_ERM3_LEGEND.strip())
    return "\n".join(lines)
