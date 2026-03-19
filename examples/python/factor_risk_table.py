#!/usr/bin/env python3
"""
RiskModels API — Factor Risk Attribution Table

Uses the /l3-decomposition endpoint to decompose monthly returns into
market, sector, subsector, and residual components.

Also includes a bonus multi-ticker portfolio factor table.

pip install requests pandas
"""

# ── Configuration ──────────────────────────────────────────────────────────────
API_KEY  = "PASTE_YOUR_KEY_HERE"   # <-- paste your RiskModels API key here
BASE_URL = "https://riskmodels.net/api"
HEADERS  = {"Authorization": f"Bearer {API_KEY}"}

import requests
import pandas as pd

if API_KEY == "PASTE_YOUR_KEY_HERE":
    raise ValueError("Please paste your API key above before running.")

# ── Use Case 3: Factor risk attribution table ──────────────────────────────────
ticker = "NVDA"   # change to any ticker

resp = requests.get(
    f"{BASE_URL}/l3-decomposition",
    headers=HEADERS,
    params={"ticker": ticker, "market_factor_etf": "SPY"}
)
resp.raise_for_status()
body = resp.json()

# Map columnar response into a tidy DataFrame
df_risk = pd.DataFrame({
    "date":         pd.to_datetime(body["dates"]),
    "market_er":    body["l3_market_er"],
    "sector_er":    body["l3_sector_er"],
    "subsector_er": body["l3_subsector_er"],
    "residual_er":  body["l3_residual_er"],
})
df_risk = df_risk.dropna().sort_values("date").reset_index(drop=True)

# Total = sum of all factor components
df_risk["total_return"] = df_risk[["market_er", "sector_er",
                                    "subsector_er", "residual_er"]].sum(axis=1)

# Convert to percentages for readability
pct_cols = ["market_er", "sector_er", "subsector_er", "residual_er", "total_return"]
df_risk[pct_cols] = (df_risk[pct_cols] * 100).round(3)
df_risk.rename(columns={c: c.replace("_er", "_%").replace("_return", "_%")
                         for c in pct_cols}, inplace=True)

print(f"Monthly factor risk attribution for {ticker} (most recent 12 months)")
print(f"Market ETF: {body['market_factor_etf']}  |  Universe: {body['universe']}")
print()
print(df_risk.tail(12).to_string(index=False))

# ── Bonus: Portfolio-level factor risk table ───────────────────────────────────
print("\n" + "="*60)
print("Portfolio-level factor risk table")
print("="*60)

tickers = ["AAPL", "MSFT", "NVDA", "GOOGL"]  # add any tickers here

all_rows = []
for t in tickers:
    r = requests.get(
        f"{BASE_URL}/l3-decomposition",
        headers=HEADERS,
        params={"ticker": t, "market_factor_etf": "SPY"}
    )
    if r.status_code != 200:
        print(f"Warning: {t} returned {r.status_code}")
        continue
    b = r.json()
    tmp = pd.DataFrame({
        "date":         pd.to_datetime(b["dates"]),
        "market_er":    b["l3_market_er"],
        "sector_er":    b["l3_sector_er"],
        "subsector_er": b["l3_subsector_er"],
        "residual_er":  b["l3_residual_er"],
    })
    tmp["ticker"] = t
    all_rows.append(tmp)

df_all = pd.concat(all_rows, ignore_index=True).dropna()

# Summarise: mean monthly factor attribution per ticker
summary = (
    df_all
    .groupby("ticker")[["market_er", "sector_er", "subsector_er", "residual_er"]]
    .mean()
    .multiply(100)
    .round(3)
)
summary.columns = ["market_%", "sector_%", "subsector_%", "residual_%"]
summary["total_%"] = summary.sum(axis=1).round(3)

print("\nAverage monthly factor attribution by ticker (in %):")
print(summary.to_string())
