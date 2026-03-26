"""Wire (V3 / batch) ↔ semantic field names."""

from __future__ import annotations

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

COLUMN_AGENT_HINTS: dict[str, str] = {
    "l1_market_hr": "SPY notional per $1 stock for L1 (market-only) hedge.",
    "l2_market_hr": "SPY component of L2 hedge.",
    "l2_sector_hr": "Sector ETF component of L2 hedge.",
    "l3_market_hr": "SPY component of L3 hedge.",
    "l3_sector_hr": "Sector ETF component of L3 hedge.",
    "l3_subsector_hr": "Subsector ETF component; may be negative (long ETF).",
    "l3_residual_er": "Idiosyncratic variance share at L3 (not hedgeable with these ETFs).",
    "returns_gross": "Daily gross stock return.",
}


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
