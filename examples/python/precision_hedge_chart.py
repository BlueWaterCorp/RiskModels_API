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
BASE_URL = "https://riskmodels.net/api"
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
def cumulative(series):
    cum = np.zeros(len(series))
    for i, r in enumerate(series):
        if i == 0:
            cum[i] = r
        else:
            cum[i] = (1 + cum[i - 1]) * (1 + r) - 1
    return cum * 100   # convert to %

df["cum_stock"]     = cumulative(df["stock"])
df["cum_market"]    = cumulative(df["l1"])
df["cum_sector"]    = cumulative(df["l2"])
df["cum_subsector"] = cumulative(df["l3"])

# ── Plot ───────────────────────────────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(12, 5))
fig.patch.set_facecolor("#0d0d0d")
ax.set_facecolor("#0d0d0d")

colors = {
    "cum_stock":     "#60a5fa",   # blue  — stock
    "cum_market":    "#6366f1",   # indigo — market (SPY)
    "cum_sector":    "#34d399",   # green — sector ETF
    "cum_subsector": "#9ca3af",   # grey  — subsector ETF
}
labels = {
    "cum_stock":     TICKER,
    "cum_market":    "Market (L1)",
    "cum_sector":    "Sector (L2)",
    "cum_subsector": "Subsector (L3)",
}

for col, color in colors.items():
    ax.plot(df["date"], df[col], color=color, linewidth=1.4, label=labels[col])

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
print(f"  Market factor return:    {latest.cum_market:.1f}%")
print(f"  Sector factor return:    {latest.cum_sector:.1f}%")
print(f"  Subsector factor return: {latest.cum_subsector:.1f}%")
print(f"  Residual (unhedgeable):  {latest.cum_stock - latest.cum_subsector:.1f}%")
