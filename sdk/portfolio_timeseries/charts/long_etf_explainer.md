# Long-ETF Explainer — Berkshire

**File:** `charts/long_etf_explainer.png` (+ `_web.png`)

## What it shows

A two-panel figure that makes the long-ETF phenomenon obvious. **Left:** Berkshire's book sector weights next to SPY's — with the tech bar split so you can see it is essentially one name (AAPL). **Right:** the overlay's net position in each sector's ETF (red = short, green = long).

## The mechanism (one sentence)

Shorting SPY imports SPY's sector weights, so where the book carries **less** of a sector than the SPY short imports, the overlay ends up **long** that sector's ETF to avoid over-hedging it.

## Why Berkshire in particular — the tech example

Berkshire's book is ~36% Information Technology, but that is **almost entirely AAPL** (35% of the book); ex-AAPL, Berkshire holds ~1% tech vs SPY's ~32%. When the overlay shorts SPY to kill market beta it imports SPY's broad, diversified ~1/3 tech weight — which AAPL alone does not match — so the net overlay goes **long** the tech ETF (-$7M). Net long-ETF sectors this quarter: Information Technology.

## Honest note on construction (bottom-up, not top-down)

This overlay is built **bottom-up** from each held stock's `decompose()` hedge ratios, **not** by comparing the book to SPY sector-by-sector. A long ETF leg appears when a *held* position's sector/subsector beta is more than covered by the SPY short (e.g. AAPL → long RSPT). Consequently the overlay does **not** add a long leg for sectors the book omits entirely: Berkshire holds ~0% Health Care (SPY ~11%), yet the overlay shows $0 in health-care ETFs because no held name references them. That is a real property of the current per-position overlay, not an error — worth flagging to Conrad as a design choice (bottom-up hedge vs. a top-down index-relative hedge).

## How it was computed

- **Book sector weights (left, navy + hatched):** each disclosed position mapped to its GICS sector via `decompose()`'s `exposure.sector.hedge_etf`, dollar-weighted (`charts/risk_detail.json`). The hatched segment is the single largest name in each sector. **API-derived.**
- **Overlay legs (right):** `charts/overlay_data.json` `etf_shorts`, grouped by each ETF's GICS sector; positive = short, negative = long. **API-derived.** SPY market leg ($45M short) shown in the footnote, not as a sector.
- **SPY sector weights (left, grey):** **public reference** (S&P 500 GICS weights, approx mid-2020s), normalized to 100%. **NOT API-derived** — the RiskModels API does not expose index constituent weights.

## Caveat

SPY weights are an approximate public reference, not a live figure; treat the left panel as illustrative of the *gap*, not a precise index snapshot. Everything about Berkshire's book and the overlay is real API output.
