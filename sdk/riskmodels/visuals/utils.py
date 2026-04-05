"""Shared helpers for σ-scaling, bar layout, and titles."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np

from ..lineage import RiskLineage

__all__ = [
    "annualized_vol_decimal",
    "annualized_vol_from_returns_values",
    "adjacent_bar_positions",
    "cascade_plotly_layout",
    "l3_er_tuple_from_row",
    "l3_rr_tuple_from_row",
    "sigma_array_from_rows",
    "format_l3_annotation_er_systematic",
    "format_l3_annotation_rr_hr",
    "build_title",
    "footnote_from_lineage",
]


def annualized_vol_decimal(row: Mapping[str, Any]) -> float | None:
    """Return annualized total vol as decimal using ``vol_23d`` / ``volatility`` / ``annualized_volatility``."""
    for key in ("vol_23d", "volatility", "annualized_volatility"):
        if key not in row or row[key] is None:
            continue
        try:
            raw = float(row[key])
        except (TypeError, ValueError):
            continue
        if not (np.isfinite(raw) and raw > 0):
            continue
        # API may return decimal (0.35) or percent (35)
        if 1.0 < raw <= 150.0:
            return raw / 100.0
        return raw
    return None


def annualized_vol_from_returns_values(
    values: Sequence[Any] | None,
    *,
    window: int = 23,
    trading_days_per_year: float = 252.0,
) -> float | None:
    """23-trading-day sample std of daily gross returns, annualized (``sqrt(252)`` scale).

    Used when snapshot ``vol_23d`` / ``volatility`` is missing from batch ``full_metrics`` but
    ``returns.values`` is present — avoids a flat σ default that makes every σ-scaled bar identical.
    """
    if not values:
        return None
    nums: list[float] = []
    for x in values:
        if x is None:
            continue
        try:
            v = float(x)
        except (TypeError, ValueError):
            continue
        if np.isfinite(v):
            nums.append(v)
    if len(nums) < 2:
        return None
    arr = np.asarray(nums[-window:] if len(nums) >= window else nums, dtype=float)
    if arr.size < 2:
        return None
    sd = float(np.std(arr, ddof=1))
    if not np.isfinite(sd) or sd <= 0:
        return None
    return float(sd * np.sqrt(trading_days_per_year))


def adjacent_bar_positions(
    weights: Sequence[float] | np.ndarray,
    *,
    gap: float = 0.0,
) -> tuple[np.ndarray, np.ndarray]:
    """Return bar centers and widths on [0, 1] so bars are adjacent (``gap=0`` → touching).

    ``weights`` should be non-negative and sum to ~1; they are normalized internally.
    Each bar *i* occupies ``[edge_i, edge_i + width_i]`` with ``edge_{i+1} = edge_i + width_i + gap``,
    so Plotly ``x=center_i``, ``width=width_i`` yields abutting rectangles on a linear [0, 1] axis.
    """
    w = np.asarray(weights, dtype=float)
    if w.size == 0:
        return np.array([]), np.array([])
    s = float(np.sum(w))
    if s <= 0:
        w = np.ones_like(w) / len(w)
    else:
        w = w / s
    cum = 0.0
    centers = np.empty_like(w)
    for i, wi in enumerate(w):
        centers[i] = cum + wi / 2.0
        cum += wi + gap
    return centers, w


def sigma_array_from_rows(rows: list[Mapping[str, Any]], *, default: float = 0.3) -> np.ndarray:
    """Annualized σ per row for MAG7-style σ-scaling (uses ``vol_23d`` / ``volatility`` via ``annualized_vol_decimal``)."""
    out: list[float] = []
    for r in rows:
        v = annualized_vol_decimal(r)
        out.append(float(v) if v is not None else default)
    return np.asarray(out, dtype=float)


def format_l3_annotation_rr_hr(row: Mapping[str, Any]) -> str:
    """Right-rail text: ETF label + total annualized σ as percent."""
    sub = (
        str(row.get("subsector_etf") or row.get("subsector_etf_symbol") or "").strip()
        or str(row.get("sector_etf") or "").strip()
    )
    vol = annualized_vol_decimal(row)
    if vol is not None:
        pct = f"{vol * 100:.0f}% total ann. σ"
    else:
        m0, s0, u0, r0 = l3_rr_tuple_from_row(row)
        pct = f"{(m0 + s0 + u0 + r0) * 100:.0f}% total ann. σ"
    return f"{sub}    {pct}" if sub else pct


def format_l3_annotation_er_systematic(row: Mapping[str, Any]) -> str:
    """Right-rail: ETF label + ER-based systematic % (no HR tail).

    Uses fixed-width columns so labels line up in a clean column (Plotly/Kaleido export).
    """
    sub = (
        str(row.get("subsector_etf") or row.get("subsector_etf_symbol") or "").strip()
        or str(row.get("sector_etf") or "").strip()
    )
    m0, s0, u0, _ = l3_er_tuple_from_row(row)
    sys_pct = m0 + s0 + u0
    if not sub:
        return f"{int(round(sys_pct * 100))}% systematic"
    etf = sub[:6]
    etf_col = f"{etf:<6}"
    pct_str = f"{int(round(sys_pct * 100))}%"
    return f"{etf_col} {pct_str} systematic"


def cascade_plotly_layout() -> dict[str, Any]:
    """Layout kwargs for variable-width adjacent bars (no spacing between position buckets)."""
    return {
        "barmode": "overlay",
        "bargap": 0,
        "bargroupgap": 0,
    }


def l3_er_tuple_from_row(row: Mapping[str, Any]) -> tuple[float, float, float, float]:
    """L3 explained-risk shares (sum ≈ 1)."""

    def pick(*keys: str) -> float:
        for k in keys:
            if k in row and row[k] is not None:
                try:
                    v = float(row[k])
                    if np.isfinite(v):
                        return v
                except (TypeError, ValueError):
                    continue
        return 0.0

    m = pick("l3_market_er", "l3_mkt_er")
    s = pick("l3_sector_er", "l3_sec_er")
    u = pick("l3_subsector_er", "l3_sub_er")
    r = pick("l3_residual_er", "l3_res_er")
    return m, s, u, r


def l3_rr_tuple_from_row(row: Mapping[str, Any]) -> tuple[float, float, float, float]:
    """L3 risk ratios for stacking; residual uses ``l3_residual_er`` (HR share in reference plots)."""

    def pick(*keys: str) -> float:
        for k in keys:
            if k in row and row[k] is not None:
                try:
                    v = float(row[k])
                    if np.isfinite(v):
                        return v
                except (TypeError, ValueError):
                    continue
        return 0.0

    m = pick("l3_market_rr", "l3_market_er", "l3_mkt_er")
    s = pick("l3_sector_rr", "l3_sector_er", "l3_sec_er")
    u = pick("l3_subsector_rr", "l3_subsector_er", "l3_sub_er")
    r = pick("l3_residual_er", "l3_res_er")
    return m, s, u, r


def build_title(
    headline: str,
    *,
    metadata: Mapping[str, Any] | None = None,
    subtitle: str | None = None,
) -> str:
    parts = [headline]
    if subtitle:
        parts.append(subtitle)
    if metadata:
        teo = metadata.get("teo") or metadata.get("data_as_of")
        mv = metadata.get("model_version")
        bits = []
        if teo:
            bits.append(f"as of {teo}")
        if mv:
            bits.append(str(mv))
        if bits:
            parts.append(" · ".join(bits))
    return "\n".join(parts)


def footnote_from_lineage(lineage: RiskLineage | None) -> str:
    if not lineage:
        return ""
    parts: list[str] = []
    if lineage.data_as_of:
        parts.append(f"Data as of {lineage.data_as_of}")
    if lineage.model_version:
        parts.append(f"Model {lineage.model_version}")
    if lineage.factor_set_id:
        parts.append(f"Universe {lineage.factor_set_id}")
    return " · ".join(parts)
