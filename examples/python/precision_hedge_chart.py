#!/usr/bin/env python3
"""
RiskModels API — Precision Hedge Chart

Visualises cumulative compound returns for a stock vs. each hedge layer
(market, sector, subsector). The gap between the stock line and hedge lines
represents the residual/idiosyncratic return that ETF hedges cannot capture.

pip install requests pandas matplotlib numpy
"""

# ── Configuration ──────────────────────────────────────────────────────────────
API_KEY  = "PASTE_YOUR_KEY_HERE"   # <-- paste your RiskModels API key here
BASE_URL = "https://riskmodels.app/api"
HEADERS  = {"Authorization": f"Bearer {API_KEY}"}

import requests
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.ticker as mtick
import numpy as np

if API_KEY == "PASTE_YOUR_KEY_HERE":
    raise ValueError("Please paste your API key above before running.")

# ── Use Case 4: Precision Hedge Chart ──────────────────────────────────────────
TICKER = "NVDA"   # change to any ticker
YEARS  = 3        # 1, 3, 5, or 15

# ── Fetch time series ──────────────────────────────────────────────────────────
resp = requests.get(
    f"{BASE_URL}/ticker-returns",
    headers=HEADERS,
    params={"ticker": TICKER, "years": YEARS},
)
resp.raise_for_status()
df = pd.DataFrame(resp.json()["data"])
df["date"] = pd.to_datetime(df["date"])
df = df.sort_values("date").reset_index(drop=True)

# ── Compute cumulative compound returns (geometric) ────────────────────────────
# Formula: cum[t] = (1 + cum[t-1]) * (1 + daily[t]) - 1
# All series start at 0% on day 0.
# NOTE: Use returns_gross (daily stock return). The l1/l2/l3 fields are hedge ratios,
# not returns; l3_mkt_er/l3_sec_er/l3_sub_er are explained-risk fractions. Factor
# return series (market, sector, subsector) require pre-computed data not in this API.
def cumulative(series):
    cum = np.zeros(len(series))
    for i, r in enumerate(series):
        if i == 0:
            cum[i] = r
        else:
            cum[i] = (1 + cum[i - 1]) * (1 + r) - 1
    return cum * 100   # convert to %

# Stock: use returns_gross (API may alias as "stock")
stock_returns = df["returns_gross"] if "returns_gross" in df.columns else df["stock"]
df["cum_stock"] = cumulative(stock_returns.fillna(0))

# Factor layers: API does not return daily factor returns. Chart stock only.
# TODO: Add market/sector/subsector lines when API exposes factor return series.

# ── Plot ───────────────────────────────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(12, 5))
fig.patch.set_facecolor("#0d0d0d")
ax.set_facecolor("#0d0d0d")

ax.plot(df["date"], df["cum_stock"], color="#60a5fa", linewidth=1.4, label=TICKER)

ax.axhline(0, color="#444", linewidth=0.8, linestyle="--")
ax.yaxis.set_major_formatter(mtick.PercentFormatter(decimals=0))
ax.tick_params(colors="#aaa", labelsize=9)
for spine in ax.spines.values():
    spine.set_edgecolor("#333")
ax.set_xlabel("Date", color="#aaa", fontsize=9)
ax.set_ylabel("Cumulative Return", color="#aaa", fontsize=9)
ax.set_title(
    f"Your Precision Hedge Recipe — {TICKER}  ({YEARS}y)",
    color="white", fontsize=12, pad=10
)
ax.legend(
    frameon=False, labelcolor="#ccc", fontsize=9,
    loc="upper left", title="Series", title_fontsize=8,
)
ax.grid(axis="y", color="#222", linewidth=0.6)
plt.tight_layout()
plt.savefig(f"{TICKER}_hedge_chart.png", dpi=150, bbox_inches="tight")
plt.show()
print(f"Chart saved to {TICKER}_hedge_chart.png")

# ── Latest values ──────────────────────────────────────────────────────────────
latest = df.iloc[-1]
print(f"\nCumulative returns over {YEARS}y — as of {latest.date.date()}")
print(f"  {TICKER} total return:    {latest.cum_stock:.1f}%")
