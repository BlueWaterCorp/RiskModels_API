#!/usr/bin/env python3
"""
RiskModels API — AI Risk Analyst (OpenAI + Live ERM3 Risk Data)

Combines live RiskModels risk metrics with an LLM to build an AI that answers
natural-language questions about your portfolio. Pattern:

  1. Fetch live hedge ratios and risk metrics via the RiskModels Python SDK
  2. Inject the data as structured context into a system prompt
  3. Ask any hedging or risk question — the model reasons over real numbers

Authentication is env-based; no hardcoded keys:

    export RISKMODELS_API_KEY=rm_agent_...   # riskmodels config init stores this
    export OPENAI_API_KEY=sk-...

Install:

    pip install riskmodels pandas openai
"""

from __future__ import annotations

import os
import sys

import pandas as pd
from openai import OpenAI
from riskmodels import RiskModelsClient


PORTFOLIO: dict[str, float] = {
    "AAPL": 0.25,
    "MSFT": 0.20,
    "NVDA": 0.20,
    "GOOGL": 0.15,
    "AMZN": 0.10,
    "JPM": 0.10,
}


def require_env(var: str) -> str:
    value = os.environ.get(var)
    if not value:
        sys.exit(
            f"error: {var} not set. `riskmodels config init` stores RISKMODELS_API_KEY; "
            f"OPENAI_API_KEY must be exported separately."
        )
    return value


def fetch_risk_table(client: RiskModelsClient, portfolio: dict[str, float]) -> pd.DataFrame:
    rows = []
    for ticker, weight in portfolio.items():
        m = client.get_metrics(ticker)
        rows.append(
            {
                "ticker": ticker,
                "weight_%": round(weight * 100, 1),
                "close": m.get("close_price"),
                "vol_ann_%": round((m.get("volatility") or 0) * 100, 1),
                "sharpe": round(m.get("sharpe_ratio") or 0, 3),
                "l1_market_hr": round(m.get("l1_market_hr") or 0, 4),
                "l2_market_hr": round(m.get("l2_market_hr") or 0, 4),
                "l2_sector_hr": round(m.get("l2_sector_hr") or 0, 4),
                "l3_market_hr": round(m.get("l3_market_hr") or 0, 4),
                "l3_sector_hr": round(m.get("l3_sector_hr") or 0, 4),
                "l3_subsector_hr": round(m.get("l3_subsector_hr") or 0, 4),
                "l1_market_er": round(m.get("l1_market_er") or 0, 4),
                "l3_residual_er": round(m.get("l3_residual_er") or 0, 4),
            }
        )
    return pd.DataFrame(rows).set_index("ticker")


SYSTEM_PROMPT_TEMPLATE = """You are an institutional equity risk analyst with expertise in ERM3 factor models.
You have access to live daily EOD factor data for a portfolio. Use ONLY the numbers provided.

ERM3 Hedge Ratio Guide:
- l1_market_hr: SPY ratio for L1 hedge (market-only, 1 trade)
- l2_market_hr / l2_sector_hr: SPY + sector ETF ratios for L2 hedge (2 trades)
- l3_market_hr / l3_sector_hr / l3_subsector_hr: all three ETFs for L3 hedge (3 trades)
- l1_market_er: fraction of risk explained by market factor (0–1)
- l3_residual_er: idiosyncratic risk fraction — cannot be hedged with ETFs

LIVE PORTFOLIO DATA:
{risk_table}

Answer concisely and always cite specific numbers from the table above."""


def main() -> None:
    require_env("RISKMODELS_API_KEY")
    openai_key = require_env("OPENAI_API_KEY")

    with RiskModelsClient.from_env() as rm:
        df = fetch_risk_table(rm, PORTFOLIO)

    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(risk_table=df.to_string())
    question = (
        "Which position has the most market risk? "
        "What hedge trades should I place to reduce it at L2?"
    )

    openai = OpenAI(api_key=openai_key)
    response = openai.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": question},
        ],
        temperature=0.2,
    )

    print(f"Q: {question}\n")
    print(response.choices[0].message.content)


if __name__ == "__main__":
    main()
