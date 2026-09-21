# Regime-Aware Portfolios — Global Ω, Two Books (extended example)

This is an extended fork of the RiskModels SDK's
[`examples/python/regime_portfolio`](../regime_portfolio) — the HMM
forward-beta implementation of Ibanez & Urga (2024), *Incorporating Market
Regimes into Large-Scale Stock Portfolios: A Hidden Markov Model Approach*
(MPRA 121552).

The original example fits one regime model per (sector, subsector) group and
builds a single mean-variance tilt against a cap-weighted benchmark. This
folder generalizes that into three independent design forks, all controlled
by one `Config` object, plus a second portfolio-construction "book":

1. **Forward-moment method** (`Config.market_var_mode` scope) —
   - `method=1`: the original per-group HMM, but on a **5-factor** set
     (market, sector, subsector, growth, size — the original used only the
     first three) with `full` covariance instead of `diag`. Group-level
     covariances are stitched into one universe-wide Ω, block-diagonal in the
     non-market part plus a single shared market term.
   - `method=2`: a single **global** HMM fit on the Fama-French 5 factors
     (`Mkt-RF, SMB, HML, RMW, CMA`) instead of per-group SDK factors, with
     stock loadings from regime-weighted least squares. Produces a dense Ω
     directly — no block-diagonal approximation.
2. **Portfolio book** —
   - `book='mvo'`: tracking-error-budget / max-Sharpe / min-variance
     optimizer against the cap-weighted benchmark (`book1_mvo`, generalizes
     the original's `build_S_alpha_weights`).
   - `book='civp'`: correlation-cluster inverse-variance weights — no
     optimizer, just hierarchical clustering on correlation + inverse-vol
     sizing within and across clusters (`book2_civp` / `cluster_ivp.py`).
3. **Correlation source** (`Config.corr_source`, book='civp' only) — take
   correlation from the Ω the regime model implies (`'omega'`), or overwrite
   it with the realized sample correlation over a trailing window while
   keeping Ω's variances (`'realized'`).

## Files

- `Data.py` — data pull and factor construction. Replaces the original
  `forward_beta.get_data`/`create_returns`. `get_data(tickers, client,
  method, resample_window)` returns the panel already orthogonalized
  (`market_ret` then `sector_o`/`subsector_o`/`growth_o`/`size_o` in that
  order via sequential residualization), for either method's factor set.
  Falls back to `Mapping.csv`'s `recommended_ffx` universe when `tickers` is
  `None`.
- `forward_beta.py` — per-group HMM fit and regime-weighted factor loadings
  (`fit_regime_model`, `compute_forward_beta`), plus `get_market_cap`. Same
  lineage as the original file, extended to 5 factors / `full` covariance.
- `portfolio_fb.py` — `compute_portfolio_weights` (per-group ψ/Ω, used by
  method 1), kept for compatibility with the original per-group flow.
- `cluster_ivp.py` — the correlation-cluster IVP book: `cluster_ivp_weights`
  (core weighting), `build_cluster_ivp_weights` (group-aware drop-in),
  `subsector_report` (cluster-IVP vs cap-weight, per subsector), and a
  standalone `backtest_cluster_ivp` for running that book against method 1
  only, outside the unified `Config` flow.
- `backtest_global.py` — the unified entry point. `Config` holds all three
  forks plus every risk/cost parameter; `forward_moments(win, method, h,
  cfg)` dispatches to `forward_moments_m1` or `forward_moments_ff` and
  returns one universe-wide `(tickers, psi, Omega)`; `backtest_global(df,
  method=, book=, ...)` runs the full walk-forward loop and prints a summary.
- `live_holdings.py` — `live_allocation`, next-period target weights for live
  use (no train/test split, no scoring). New in this folder — the original's
  `live_hmm_holdings.py` only covered method 1 + the MVO book.
- `Main.ipynb` — driver notebook.
- `Mapping.csv` — ticker -> `recommended_ffx` (subsector proxy) mapping used
  by `Data.get_tickers` / `Data.add_sector_subsector`.

## Install

Same as the original example: the `riskmodels` SDK
(`RiskModelsClient.from_env()`, no key in code), plus `numpy`, `pandas`,
`scipy`, `scikit-learn`, `hmmlearn`. Additionally: `xarray` and
`gcsfs`/`zarr` (for `Data.py`'s public zarr dataset), `pandas-datareader`
(for the Fama-French pull), and `matplotlib` if you use `portfolio_fb.py`'s
plotting.

Unlike the original package, these files import each other directly
(`from forward_beta import ...`, not `from .forward_beta import ...`), so run
from *inside* this folder, not from the level above it.

## Run sequence

```python
from riskmodels import RiskModelsClient
from Data import get_data
from backtest_global import Config, backtest_global

client = RiskModelsClient.from_env()

tickers = ['XOM', 'CVX', 'COP', 'SLB', 'JPM', 'BAC', 'WFC', 'C',
          'JNJ', 'PFE', 'MRK', 'ABT', 'PG', 'KO', 'PEP', 'WMT']   # or None = Mapping.csv universe

# pull once, cache it — this is the expensive, API-credit-consuming step
df = get_data(tickers, client, method=1, resample_window='W')
# df.to_parquet('universe.parquet')   # then reload instead of re-pulling

cfg = Config(mvo_objective='te_budget', corr_source='omega', market_var_mode='largest')
bt = backtest_global(df, method=1, book='mvo', split_start='2013-01-01',
                     forward=1, cfg=cfg, client=client)
```

Swap `method=2` for the Fama-French global HMM, or `book='civp'` for the
cluster-IVP book (add `corr_source='realized'` to blend in realized
correlation).

For live next-period weights:

```python
from live_holdings import live_allocation

stock_w = live_allocation(client, tickers, method=1, book='mvo',
                          horizon='W', h=1, cfg=Config())
```

## Config reference

| Field | Default | Meaning |
|---|---|---|
| `market_var_mode` | `'largest'` | Method 1 only: how per-group market variances combine into one universe-wide `s2g` — `'largest'` group's, cap-weighted (`'capw'`), or plain mean (`'mean'`). |
| `mvo_objective` | `'te_budget'` | Book 1: `'te_budget'` (paper's eq. 10, maximize ψ·w under a TE constraint), `'max_sharpe'` (mean-variance with `risk_aversion`), or `'min_var'`. |
| `corr_source` | `'omega'` | Book 2 only: correlation from Ω (`'omega'`) or from the realized sample window (`'realized'`). |
| `te_vol_annual` | `0.04` | Annualized tracking-error budget for `te_budget`. |
| `risk_aversion` | `5.0` | λ for `max_sharpe`. |
| `long_only` | `True` | Bounds passed to the SLSQP optimizer. |
| `corr_threshold` | `0.5` | Book 2: correlation cut mapped to a linkage distance for cluster formation. |
| `max_clusters` | `None` | Book 2: cap on cluster count (re-cuts by `maxclust` if exceeded). |
| `realized_window` | `None` → 52 (W) / 252 (D) | Trailing window for `corr_source='realized'`. |
| `regimes` | `2` | HMM states, both methods. |
| `kill_pi` | `None` | Diagnostic: `'identity'` (no transition) or `'uniform'` (random next regime). |
| `n_seeds` | `8` | Method 2 only — global HMM restarts (method 1's per-group HMM restarts are hardcoded at 10 in `forward_beta.fit_regime_model`, not `cfg`-driven). |
| `n_iter` | `1000` | Method 2 only — EM iterations per restart (method 1 is hardcoded at 2000). |
| `min_obs` | `30` | Method 2 only — minimum overlapping stock/factor observations to fit a stock's loadings. |
| `cost_bps` | `10.0` | Per-unit-turnover cost, charged every rebalance in `backtest_global`. |
| `ridge` | `1e-10` | PSD ridge added to Ω before use. |
| `ppy` | set at runtime | Periods/year ÷ `forward`; don't set by hand. |

## Limitations (read before trusting results)

Everything in the original README still applies — survivorship bias from
using today's market-cap snapshot, the block-diagonal cross-group
approximation for method 1, the need for long regime-fitting history, and
modest/fragile empirical edge. On top of that, specific to this folder:

- **`n_seeds`/`n_iter` asymmetry.** `Config.n_seeds`/`n_iter` only govern
  method 2's global HMM. Method 1's per-group HMM restarts (10 seeds, 2000
  EM iterations) are hardcoded inside `forward_beta.fit_regime_model` and
  ignore `cfg` — changing `cfg.n_seeds` silently does nothing under
  `method=1`.
- **`Mapping.csv` case sensitivity.** `Data.add_sector_subsector` reads
  `'mapping.csv'` (lowercase) while the shipped file is `Mapping.csv`. This
  works on case-insensitive filesystems and will raise `FileNotFoundError`
  on Linux/most CI. Rename the read (or the file) to match before running
  method 1 end-to-end.
- **Method 2's Ω is dense, not block-diagonal** — it doesn't inherit method
  1's cross-group approximation, but it also means memory/optimizer cost
  scales differently (a full `n×n` solve/clustering instead of per-group
  blocks) as the universe grows.
- **`book='civp'` has no tracking-error or turnover control** — it's pure
  risk/correlation sizing, so it can drift arbitrarily far from the
  benchmark. Compare its `n_held`/turnover against `book='mvo'` before
  assuming it's the lower-cost option.
- **`live_holdings.py` inherits every fitting requirement above** — it will
  raise (not silently degrade) if the universe is too sparse or history too
  short for the chosen method, rather than falling back to a naive weighting.
