# get_alpha for QuantConnect

`get_alpha(symbol, direction, dollars)` turns a buy or sell signal into an alpha trade: the stock held against the ETF basket
that the RiskModels model keeps for that name (the L* level). A buy signal names a ticker and a dollar size. The call is
`GET /api/hedge-basket/{ticker}`, which returns each hedge leg as a signed ratio, dollars of that ETF per dollar of stock.
The stock leg is +1 per dollar of signal, and a sell multiplies every leg by -1.

## Depth: which hedge level the legs come from

`depth` picks the basket's depth. L1 is the market ETF, L2 adds the sector ETF and L3 adds the subsector ETF. The model stores a
depth for each name, L\*.

| `depth` | Legs come from | Cap and floor |
|---|---|---|
| `"recommended"` (default) | The stored L\*, stepped down when needed | Applied: a level drops when its gross hedge exceeds the `user_segment` cap, or when the next layer's explained risk, after a 30% haircut, is under 1% |
| `"lstar"` | The stored L\* | Not applied |
| `"L1"`, `"L2"`, `"L3"` | The level you choose | Not applied; read `hedge_gross` in the response if the gross matters |

`user_segment` sets the gross-hedge cap used by `"recommended"`:

| `user_segment` | Cap on gross hedge per $1 of stock |
|---|---:|
| `retail` | 1.5x |
| `family_office` (API default) | 2.0x |
| `ls_equity` | 3.0x |
| `stat_arb` | 5.0x |

Example for NVDA on 9 November 2026 (L2 basket, `stat_arb`), per $1,000,000 bought: NVDA +$1,000,000, SPY -$18,341,
XLK -$1,093,390. At L1 the basket is the stock and SPY only; L3 adds the subsector ETF.

## Files

| File | Use |
|---|---|
| `riskmodels_alpha.py` | Standard-library helper. Runs in the QuantConnect cloud with no package install. |
| `RiskModelsAlphaAlgorithm.py` | A daily algorithm with a short book of five signals; it logs the wall time of every call. |

Python users can call `RiskModelsClient.get_alpha(...)` from `riskmodels-py` instead; the arithmetic is identical and a test
keeps the two in step.

## Run it in QuantConnect

1. Create a project and add both files.
2. Add the project parameter `riskmodels_api_key` with a dedicated trial key (scope `hedge-basket`, expiry and daily cap set;
   `scripts/generate-trial-key.mjs` creates one).
3. Run the backtest and read the log: each line shows the leg count, hedge level, `as_of` and the call time in milliseconds.

## What the run does and does not show

The API serves today's basket. A backtest over earlier dates therefore reads the current ratios and is not a performance test.
The run shows the plumbing and the per-call latency from the QuantConnect cloud. Baskets as of each past date require the
point-in-time history file (`POST /api/portfolio/exposure/history/daily`, or the full weekly cross-section).
