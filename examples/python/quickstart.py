#!/usr/bin/env python3
"""
RiskModels API — Quickstart: Hedge a Single Stock

Fetches daily returns and rolling L1/L2/L3 hedge ratios for a ticker.
The latest row gives the current hedge ratio to use for a live trade.

pip install requests pandas pyarrow   # pyarrow for Parquet support
"""

# ── Configuration ──────────────────────────────────────────────────────────────
API_KEY  = "PASTE_YOUR_KEY_HERE"   # <-- paste your RiskModels API key here
BASE_URL = "https://riskmodels.net/api"
HEADERS  = {"Authorization": f"Bearer {API_KEY}"}

import requests
import pandas as pd

# Quick sanity check
if API_KEY == "PASTE_YOUR_KEY_HERE":
    raise ValueError("Please paste your API key above before running.")

print("Config ready. Key prefix:", API_KEY[:16] + "...")

# ── Use Case 1: Hedge a single stock ───────────────────────────────────────────
ticker = "NVDA"   # change to any ticker, e.g. "AAPL", "TSLA", "MSFT"

resp = requests.get(
    f"{BASE_URL}/ticker-returns",
    headers=HEADERS,
    params={"ticker": ticker, "years": 1}
)
resp.raise_for_status()
body = resp.json()

# Map response into a DataFrame
df = pd.DataFrame(body["data"])
df.rename(columns={
    "stock": "stock_return",
    "l1":    "l1_hedge",
    "l2":    "l2_hedge",
    "l3":    "l3_hedge",
}, inplace=True)
df["date"] = pd.to_datetime(df["date"])
df = df.sort_values("date").reset_index(drop=True)

meta   = body["meta"]
latest = df.iloc[-1]

# ── Latest hedge ratios — transposed for readability ──────────────────────────
snapshot = pd.DataFrame({
    "Value": {
        "market_etf":               meta["market_etf"],
        "sector_etf":               meta["sector_etf"],
        "subsector_etf":            meta["subsector_etf"],
        "L1 hedge (market only)":   round(latest.l1_hedge, 4),
        "L2 hedge (market+sector)": round(latest.l2_hedge, 4),
        "L3 hedge (full)":          round(latest.l3_hedge, 4),
    }
})
print(f"\nLatest hedge ratios — {ticker}")
print(snapshot.to_string())

# ── Recent history ─────────────────────────────────────────────────────────────
print(f"\nMost recent 10 trading days:")
print(df[["date", "stock_return", "l1_hedge", "l2_hedge", "l3_hedge"]].tail(10).to_string())

# ── Cost info ─────────────────────────────────────────────────────────────────
agent = body.get("_agent", {})
print(f"\nRequest cost: ${agent.get('cost_usd', 0):.4f}  |  Cache: {agent.get('cache_status')}  |  Latency: {agent.get('latency_ms')}ms")

# ── Lineage metadata (model version, data freshness) ───────────────────────────
meta_lineage = body.get("_metadata", {})
if meta_lineage:
    print(f"Data as of: {meta_lineage.get('data_as_of')}  |  Model: {meta_lineage.get('model_version')}")

# ── Use Case 2: Pre-flight cost estimate ──────────────────────────────────────
# Call POST /estimate before expensive requests to avoid surprise bills.
est = requests.post(
    f"{BASE_URL}/estimate",
    headers=HEADERS,
    json={"endpoint": "ticker-returns", "params": {"ticker": ticker, "years": 5}},
)
est.raise_for_status()
est_body = est.json()
print(f"\nEstimate for 5yr ticker-returns: ${est_body.get('estimated_cost_usd', 0):.4f}")

# ── Use Case 3: Download as Parquet (for pandas/polars) ───────────────────────
# Use ?format=parquet to get a binary Parquet file instead of JSON.
parquet_resp = requests.get(
    f"{BASE_URL}/ticker-returns",
    headers=HEADERS,
    params={"ticker": ticker, "years": 1, "format": "parquet"},
)
parquet_resp.raise_for_status()
parquet_path = f"{ticker}_returns.parquet"
with open(parquet_path, "wb") as f:
    f.write(parquet_resp.content)
print(f"\nParquet saved to {parquet_path} ({len(parquet_resp.content)} bytes)")
df_parquet = pd.read_parquet(parquet_path)
print(f"Rows: {len(df_parquet)}")

# ── Use Case 4: Batch with format=parquet ──────────────────────────────────────
# POST /batch/analyze accepts format in body for flattened tabular export.
# batch_resp = requests.post(f"{BASE_URL}/batch/analyze", headers=HEADERS,
#     json={"tickers": ["AAPL", "MSFT"], "metrics": ["returns"], "years": 1, "format": "parquet"})
# with open("batch_returns.parquet", "wb") as f: f.write(batch_resp.content)
