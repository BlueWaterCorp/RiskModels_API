#!/usr/bin/env python3
"""
RiskModels API — AI Risk Analyst (GPT-4o + Live Factor Data)

Combines live RiskModels risk metrics with an LLM to build an AI that answers
natural-language questions about your portfolio. Pattern:
  1. Fetch live hedge ratios and risk metrics from the RiskModels API
  2. Inject the data as structured context into a system prompt
  3. Ask any hedging or risk question — the model reasons over real numbers

pip install requests pandas openai
"""

# ── Configuration ──────────────────────────────────────────────────────────────
API_KEY        = "PASTE_YOUR_KEY_HERE"      # <-- your RiskModels API key
OPENAI_API_KEY = "PASTE_YOUR_OPENAI_KEY"    # <-- your OpenAI API key
BASE_URL = "https://riskmodels.net/api"
HEADERS  = {"Authorization": f"Bearer {API_KEY}"}

import requests
import pandas as pd
from openai import OpenAI

if API_KEY == "PASTE_YOUR_KEY_HERE":
    raise ValueError("Please paste your RiskModels API key above before running.")
if OPENAI_API_KEY == "PASTE_YOUR_OPENAI_KEY":
    raise ValueError("Please paste your OpenAI API key above before running.")

# ── Step 1: Fetch live risk metrics for the portfolio ──────────────────────────
portfolio = {
    "AAPL": 0.25,
    "MSFT": 0.20,
    "NVDA": 0.20,
    "GOOGL": 0.15,
    "AMZN": 0.10,
    "JPM":  0.10,
}

metrics_rows = []
for t in portfolio:
    r = requests.get(f"{BASE_URL}/metrics/{t}", headers=HEADERS)
    if r.status_code == 200:
        m = r.json()
        metrics_rows.append({
            "ticker":          t,
            "weight_%":        round(portfolio[t] * 100, 1),
            "close":           m.get("close_price"),
            "vol_ann_%":       round((m.get("volatility") or 0) * 100, 1),
            "sharpe":          round(m.get("sharpe_ratio") or 0, 3),
            "l1_market_hr":    round(m.get("l1_market_hr") or 0, 4),
            "l2_market_hr":    round(m.get("l2_market_hr") or 0, 4),
            "l2_sector_hr":    round(m.get("l2_sector_hr") or 0, 4),
            "l3_market_hr":    round(m.get("l3_market_hr") or 0, 4),
            "l3_sector_hr":    round(m.get("l3_sector_hr") or 0, 4),
            "l3_subsector_hr": round(m.get("l3_subsector_hr") or 0, 4),
            "l1_market_er":    round(m.get("l1_market_er") or 0, 4),
            "l3_residual_er":  round(m.get("l3_residual_er") or 0, 4),
        })
    else:
        print(f"Warning: {t} returned {r.status_code}")

df_ai = pd.DataFrame(metrics_rows).set_index("ticker")

# ── Step 2: Render the data as a compact text table for the prompt ─────────────
risk_table = df_ai.to_string()

system_prompt = f"""You are an institutional equity risk analyst with expertise in factor models.
You have access to live ERM3 factor data for a portfolio. Use ONLY the numbers provided.

ERM3 Hedge Ratio Guide:
- l1_market_hr: SPY ratio for L1 hedge (market-only, 1 trade)
- l2_market_hr / l2_sector_hr: SPY + sector ETF ratios for L2 hedge (2 trades)
- l3_market_hr / l3_sector_hr / l3_subsector_hr: all three ETFs for L3 hedge (3 trades)
- l1_market_er: fraction of risk explained by market factor (0–1)
- l3_residual_er: idiosyncratic risk fraction — cannot be hedged with ETFs

LIVE PORTFOLIO DATA:
{risk_table}

Answer concisely and always cite specific numbers from the table above."""

# ── Step 3: Ask a question ──────────────────────────────────────────────────────
question = "Which position has the most market risk? What hedge trades should I place to reduce it at L2?"

# ── Step 4: Call GPT-4o ────────────────────────────────────────────────────────
client = OpenAI(api_key=OPENAI_API_KEY)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": system_prompt},
        {"role": "user",   "content": question},
    ],
    temperature=0.2,
)

print(f"Q: {question}\n")
print(response.choices[0].message.content)
