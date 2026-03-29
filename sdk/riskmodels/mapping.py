"""Wire (V3 / batch) ↔ semantic field names."""

from __future__ import annotations

import math
from typing import Any

# Curated share-class shortcuts (upper-case keys). Expand as needed.
TICKER_ALIAS_MAP: dict[str, str] = {
    "GOOGL": "GOOG",
}

# GET /metrics/{ticker} metrics.* abbreviated keys → documentation-style names
METRICS_V3_TO_SEMANTIC: dict[str, str] = {
    "l1_mkt_hr": "l1_market_hr",
    "l1_mkt_er": "l1_market_er",
    "l1_res_er": "l1_residual_er",
    "l2_mkt_hr": "l2_market_hr",
    "l2_sec_hr": "l2_sector_hr",
    "l2_mkt_er": "l2_market_er",
    "l2_sec_er": "l2_sector_er",
    "l2_res_er": "l2_residual_er",
    "l3_mkt_hr": "l3_market_hr",
    "l3_sec_hr": "l3_sector_hr",
    "l3_sub_hr": "l3_subsector_hr",
    "l3_mkt_er": "l3_market_er",
    "l3_sec_er": "l3_sector_er",
    "l3_sub_er": "l3_subsector_er",
    "l3_res_er": "l3_residual_er",
}

# Batch Parquet/CSV long table: OpenAPI field names → semantic (L3 component HR series)
BATCH_RETURNS_LONG_RENAME: dict[str, str] = {
    "gross_return": "returns_gross",
    "l1": "l3_market_hr",
    "l2": "l3_sector_hr",
    "l3": "l3_subsector_hr",
}

# Ticker-returns daily row: already mostly V3; rename to semantic where needed
TICKER_RETURNS_COLUMN_RENAME: dict[str, str] = {
    "l3_mkt_hr": "l3_market_hr",
    "l3_sec_hr": "l3_sector_hr",
    "l3_sub_hr": "l3_subsector_hr",
    "l3_mkt_er": "l3_market_er",
    "l3_sec_er": "l3_sector_er",
    "l3_sub_er": "l3_subsector_er",
    "l3_res_er": "l3_residual_er",
}

# POST /batch/analyze `hedge_ratios` uses short keys; same economics as full_metrics *_hr.
HEDGE_RATIOS_SHORT_TO_SEMANTIC_HR: dict[str, str] = {
    "l1_market": "l1_market_hr",
    "l2_market": "l2_market_hr",
    "l2_sector": "l2_sector_hr",
    "l3_market": "l3_market_hr",
    "l3_sector": "l3_sector_hr",
    "l3_subsector": "l3_subsector_hr",
}

COLUMN_AGENT_HINTS: dict[str, str] = {
    "l1_market_hr": "SPY notional per $1 stock for L1 (market-only) hedge; may be negative.",
    "l2_market_hr": "SPY component of L2 hedge; may be negative (common).",
    "l2_sector_hr": "Sector ETF component of L2 hedge; may be negative.",
    "l3_market_hr": "SPY component of L3 hedge; may be negative (common).",
    "l3_sector_hr": "Sector ETF component of L3 hedge; may be negative.",
    "l3_subsector_hr": "Subsector ETF component; may be negative.",
    "l3_residual_er": "Idiosyncratic variance share at L3 (not hedgeable with these ETFs).",
    "returns_gross": "Daily gross stock return.",
    "macro_corr_bitcoin": "Pearson/Spearman vs bitcoin daily return; not a hedge ratio.",
    "macro_corr_gold": "Pearson/Spearman vs gold daily return; not a hedge ratio.",
    "macro_corr_oil": "Pearson/Spearman vs oil daily return; not a hedge ratio.",
    "macro_corr_dxy": "Pearson/Spearman vs DXY daily return; not a hedge ratio.",
    "macro_corr_vix": "Pearson/Spearman vs VIX daily return; not a hedge ratio.",
    "macro_corr_ust10y2y": "Pearson/Spearman vs UST 10y–2y spread daily return; not a hedge ratio.",
    "macro_return_type": "Stock return series used for correlation: gross | l1 | l2 | l3_residual.",
    "macro_window_days": "Requested trailing paired-day window for correlation.",
    "macro_corr_method": "pearson or spearman.",
    "macro_overlap_days": "Largest paired observation count among requested factors.",
    "macro_warnings": "API warnings (e.g. sparse macro_factors).",
    "macro_batch_error": "Batch item error message when POST /correlation fails for one ticker.",
    "macro_batch_status": "HTTP-style status for a failed batch correlation item.",
}


def _missing_value_for_hr_merge(v: Any) -> bool:
    """True if we should overwrite with hedge_ratios (None or NaN — not zero)."""
    if v is None:
        return True
    if isinstance(v, float) and math.isnan(v):
        return True
    return False


def omit_nan_float_fields(d: dict[str, Any]) -> dict[str, Any]:
    """Drop float NaN entries so wire keys do not overwrite merged values during normalize."""
    return {k: v for k, v in d.items() if not (isinstance(v, float) and math.isnan(v))}


def merge_batch_hedge_ratios_into_full_metrics(full_metrics: dict, hedge_ratios: Any) -> dict:
    """Copy dollar HRs from `hedge_ratios` into long `*_hr` keys when missing or null in full_metrics."""
    out = dict(full_metrics)
    if not isinstance(hedge_ratios, dict):
        return out
    for short_k, sem_k in HEDGE_RATIOS_SHORT_TO_SEMANTIC_HR.items():
        if short_k not in hedge_ratios:
            continue
        v = hedge_ratios[short_k]
        if v is None or (isinstance(v, float) and math.isnan(v)):
            continue
        if sem_k not in out or _missing_value_for_hr_merge(out.get(sem_k)):
            out[sem_k] = v
    return out


def normalize_metrics_v3(metrics: dict) -> dict:
    """Flatten V3 metrics dict to semantic keys; add volatility alias."""
    out: dict = {}
    for k, v in metrics.items():
        sk = METRICS_V3_TO_SEMANTIC.get(k, k)
        out[sk] = v
    if "vol_23d" in out and "volatility" not in out:
        out["volatility"] = out["vol_23d"]
    if "price_close" in out and "close_price" not in out:
        out["close_price"] = out["price_close"]
    return out
