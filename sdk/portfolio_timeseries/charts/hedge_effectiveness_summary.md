# Hedge Effectiveness Summary — all filers, all windows

_Realized β of the raw long book vs. the industry-axis-hedged book against SPY, per time window. β reduction = 1 − hedged β / raw β. Static current-overlay method (today's book applied backward); see per-filer captions and Deliverable 4 for the point-in-time version._

| Filer | Book date | Window | Raw β | Hedged β | β reduction |
|---|---|---|---|---|---|
| **Pershing** | 2025-12-31 | 3-month | +0.86 | -0.029 | 103% |
|  |  | 6-month | +1.00 | -0.014 | 101% |
|  |  | 12-month | +1.07 | +0.044 | 96% |
|  |  | 24-month | +1.05 | -0.032 | 103% |
| | | | | | |
| **Appaloosa** | 2025-12-31 | 3-month | +1.66 | +0.061 | 96% |
|  |  | 6-month | +1.53 | +0.008 | 100% |
|  |  | 12-month | +1.52 | +0.011 | 99% |
|  |  | 24-month | +1.31 | -0.136 | 110% |
| | | | | | |
| **Greenlight** | 2023-12-31 | 3-month | +0.17 | +0.075 | 55% |
|  |  | 6-month | +0.51 | +0.225 | 56% |
|  |  | 12-month | +0.66 | +0.314 | 52% |
|  |  | 24-month | +1.05 | +0.599 | 43% |
| | | | | | |

## How to read it

- A large, consistent β reduction across filers is the evidence that the industry-axis overlay **generalizes** beyond Berkshire.
- The hedged β can creep up at longer windows where the *static* overlay (today's book applied backward) no longer matches the book actually held then — most visibly **Berkshire 24-mo (0.22)** and **Greenlight** (stale book). Pershing and Appaloosa stay near zero even at 24 months. This window-dependence is exactly why the point-in-time backtest (Deliverable 4) matters.
- Greenlight's book is stale (2023-12-31); treat its row as indicative only.
