#!/usr/bin/env python3
"""
RiskModels API — Hedge a Portfolio

Uses the /batch/analyze endpoint to fetch the full 6-component hedge breakdown
for multiple tickers in one call (25% cheaper than individual calls).

Computes weighted portfolio-level hedge ratios across all positions.

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

# ── Use Case 2: Hedge a portfolio ──────────────────────────────────────────────
# Define portfolio: ticker -> weight (weights should sum to 1.0)
portfolio = {
    "AAPL":  0.25,
    "MSFT":  0.20,
    "NVDA":  0.20,
    "GOOGL": 0.15,
    "AMZN":  0.10,
    "JPM":   0.10,
}

resp = requests.post(
    f"{BASE_URL}/batch/analyze",
    headers=HEADERS,
    json={
        "tickers": list(portfolio.keys()),
        "metrics": ["hedge_ratios"],
        "years": 1,
    }
)
resp.raise_for_status()
results = resp.json()["results"]

# ── Per-position breakdown ─────────────────────────────────────────────────────
rows = []
for ticker, weight in portfolio.items():
    r  = results.get(ticker, {})
    hr = r.get("hedge_ratios") or {}   # null-safe: API returns null if ticker missing
    rows.append({
        "ticker":       ticker,
        "weight":       weight,
        "status":       r.get("status", "error"),
        "l1_market_hr": hr.get("l1_market"),
        "l2_market_hr": hr.get("l2_market"),
        "l2_sector_hr": hr.get("l2_sector"),
        "l3_market_hr": hr.get("l3_market"),
        "l3_sector_hr": hr.get("l3_sector"),
        "l3_sub_hr":    hr.get("l3_subsector"),
    })

df_port = pd.DataFrame(rows).set_index("ticker")

# ── Weighted portfolio-level hedge ratios ──────────────────────────────────────
for col in ["l1_market_hr", "l2_market_hr", "l3_market_hr"]:
    df_port[f"w_{col}"] = df_port["weight"] * df_port[col]

port_summary = pd.DataFrame({
    "Value": {
        "L1 market hedge (wtd)": round(df_port["w_l1_market_hr"].sum(), 4),
        "L2 market hedge (wtd)": round(df_port["w_l2_market_hr"].sum(), 4),
        "L3 market hedge (wtd)": round(df_port["w_l3_market_hr"].sum(), 4),
    }
})
print("Portfolio-level hedge ratios (weighted average):")
print(port_summary.to_string())

# ── Per-position table ─────────────────────────────────────────────────────────
print("\nPer-position breakdown:")
print(df_port[["weight", "status", "l1_market_hr", "l2_market_hr",
               "l2_sector_hr", "l3_market_hr", "l3_sector_hr", "l3_sub_hr"]].to_string())

# ── Cost info ─────────────────────────────────────────────────────────────────
agent = resp.json().get("_agent", {})
print(f"\nBatch cost: ${agent.get('cost_usd', 0):.4f}  |  Positions: {len(portfolio)}")
