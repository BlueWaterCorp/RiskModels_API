# Regime-Aware Sector Rotation (HMM Forward-Beta)

A RiskModels SDK example that implements the regime-conditional portfolio
construction of Ibanez & Urga (2024), *Incorporating Market Regimes into
Large-Scale Stock Portfolios: A Hidden Markov Model Approach* (MPRA 121552).

A Hidden Markov Model is fit on a parsimonious factor set, regime-weighted
least squares (RWLS) produces forward-looking regime-conditional factor
loadings per stock, and those project the regime-mixed factor mean/covariance
back into stock space. A mean-variance optimizer then tilts sector/subsector
weights against a value-weighted benchmark under a tracking-error budget.

This implementation differs from the paper in two deliberate ways, both forced
by the SDK's data model:

- **Factors.** The paper trains the HMM on the Fama-French five factors. This
  example uses the SDK's own hierarchical factor triple — market (SPY),
  sector ETF, subsector ETF — orthogonalized in that order. Groups are formed
  by (sector ETF, subsector ETF) pairs from `client.decompose()`.
- **Cross-group risk.** Because each (sector, subsector) group is fit on its
  own factor triple, there is no shared factor space across groups except the
  market. The covariance is therefore block-diagonal in the
  sector/subsector/idiosyncratic part, with a single shared market term added
  across all stocks. See *Limitations*.

## Files

- `forward_beta.py` — data pull, weekly/daily/monthly returns, per-group HMM
  fit, RWLS factor loadings, forward betas (`get_forward_beta` is the
  end-to-end entry point).
- `portfolio_fb.py` — `ψ`/`Ω` construction, the S/α optimizer
  (`build_S_alpha_weights`), the walk-forward backtest
  (`backtest_result_HMM`), plotting, and three diagnostic ablations.
- `live_hmm_holdings.py` — `live_allocation`, the next-period target weights
  for live use (no train/test split, no scoring).

## Install

Requires the `riskmodels` SDK (configured via `RiskModelsClient.from_env()`,
no key in code), plus `numpy`, `pandas`, `scipy`, `scikit-learn`, `hmmlearn`,
`matplotlib`.

## Run sequence

Run from the `examples/python/` directory (the level above `regime_portfolio/`)
so the `regime_portfolio` package is importable.

Pull the data once (this is the expensive, API-credit-consuming step — cache
it), then fit and backtest off the cached frame.

```python
from riskmodels import RiskModelsClient
from regime_portfolio import get_forward_beta, backtest_result_HMM

client = RiskModelsClient.from_env()

tickers = ['XOM','CVX','COP','SLB','JPM','BAC','WFC','C',
           'JNJ','PFE','MRK','ABT','PG','KO','PEP','WMT']   # or None = full universe

# end-to-end: data -> returns -> market cap -> regime fit -> forward betas
all_thetas, group_hmms, group_map, data, all_fwd = get_forward_beta(
    horizon='W', forward=1, client=client, tickers=tickers, regimes=2)

# walk-forward backtest (split is fixed inside; pass only `data`)
bt = backtest_result_HMM(data, split='2020-01-01', regimes=2,
                         forward=1, horizon='W')
```

`bt` is a per-rebalance DataFrame and `backtest_result_HMM` also draws the
cumulative-growth + drawdown chart. To avoid re-pulling, save `data` once
(`data.to_parquet('universe.parquet')`) and reload it instead of re-calling
`get_forward_beta`.

For live next-period weights:

```python
from regime_portfolio import live_allocation
stock_w, group_w = live_allocation(client, tickers, horizon='W', h=1, regimes=2)
# group_w = sector/subsector (ETF) allocation; stock_w = per-stock weights
```

## Parameters the user controls

| Parameter | Where | Meaning |
|---|---|---|
| `tickers` | `get_forward_beta`, `live_allocation` | Investable universe. `None` pulls the full SDK universe (heavy — thousands of API calls). |
| `horizon` | all entry points | Return frequency: `'D'` daily, `'W'` weekly, `'ME'` month-end. Sets the annualization base (252 / 52 / 12). |
| `forward` (`h`) | all entry points | Projection horizon **and** rebalance step, coupled as in the paper (paper uses weekly bars, `h=4` for monthly rebalancing). Forward beta is `γ·Π^h·Θ`. |
| `regimes` | all entry points | Number of HMM states. Paper selects 4 by BIC on FF5; on the SDK's 3-factor triple BIC is typically flat — the code prints per-group BIC so you can choose. `2` is a safe default here. |
| `split` | `backtest_result_HMM` | Train/test cutoff date. Data before it trains the first window; the test window expands forward. Keep training through ~2020 so the HMM has enough history. |
| `kill_pi` | `backtest_result_HMM` | Diagnostic. `None` = real transition matrix; `'identity'` = regime never transitions; `'uniform'` = next regime random. Used to test whether the Π forecasting adds value. |

Not exposed (hard-coded, change in source if needed): tracking-error budget
(`0.04` annual), transaction cost (`COST_BPS=10`), thin-regime warning floor
(`MIN_OBS=5`), HMM seeds (10) and `n_iter` (2000), the `<250`-observation
group gate, and the `<2`-stocks-per-group gate.

## Built-in benchmarks and diagnostics

The backtest scores, on identical holding windows, alongside the regime
portfolio: a regimes-off cap-weighted portfolio of the same stocks
(`static_capweight`), an equal-weight (1/N) portfolio, SPY, and a
turnover-cost-adjusted version of the regime portfolio. Comparing
`port_growth` vs `static_growth` isolates the value of the regime tilt;
`port_growth_net` vs `ew_growth`/`spy_growth` tests whether any edge survives
costs. Running the backtest a second time with `kill_pi='identity'` and
overlaying via `plot_pi_comparison` isolates the transition matrix.

## Limitations (read before trusting results)

- **Survivorship / look-ahead in the backtest.** `get_market_cap` uses the
  current market-cap snapshot, so historical windows are cap-weighted by
  today's caps. For live allocation this is correct (you want today's caps);
  for the historical backtest it is a known bias.
- **Two stocks per group minimum.** A (sector, subsector) group with fewer
  than 2 of the user's tickers is skipped — it can't form a within-group
  covariance. Sparse universes degenerate toward cap-weighting (no sector
  rotation to express).
- **Regime detection needs history.** The HMM needs a long, stable sample;
  groups with `<250` observations are skipped, and thin regimes are warned.
  Keep the training span long (through ~2020+).
- **Block-diagonal cross-group risk.** Because groups use different factor
  triples, cross-group covariance is captured only through the shared market
  factor, and that market variance is taken from the largest group — a
  heuristic, not a derived quantity. This understates true tracking error.
- **Empirical edge is modest.** On a non-tech multi-sector universe at weekly
  rebalancing, the regime tilt's gross edge over plain cap-weighting was small
  and did not survive transaction costs; neutering the transition matrix
  barely changed results. The benchmarks and `kill_pi` flag are included so
  reviewers can verify this directly. Treat the framework as a correct,
  testable implementation, not a proven alpha.
- **Regime detection signal is weak.** On the tested universes the regime
  layer added little over cap-weighting once costs were applied (see the
  built-in ablations). Improving regime detection — including relaxing the
  Gaussian-emission assumption and refinements to the RWLS step — is identified
  as future work. 
- **ETF implementation.** Because the optimizer tilts only at the
  sector/subsector level (α) while cap-weighting stocks within each group (S),
  the resulting `group_w` can be traded directly as sector/subsector ETF
  weights instead of individual stocks. This lowers turnover and transaction
  cost, since group-level weights are smoother than stock-level weights.
