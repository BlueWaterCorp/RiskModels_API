# live_holdings.py — next-period target weights for live trading (no train/test split, no scoring)
#
# Mirrors regime_portfolio/live_hmm_holdings.py from the original SDK example
# (single 3-factor HMM -> build_S_alpha_weights), but adapted to this folder's
# global-Omega architecture: two forward-moment methods (SDK triple+growth/size
# vs Fama-French 5-factor), two books (MVO vs correlation-cluster IVP), and the
# Config dataclass that forks between them. See README.md for the full picture.

import pandas as pd

from Data import get_data
from forward_beta import get_market_cap
from backtest_global import Config, forward_moments, book1_mvo, book2_civp, _realized_cov


def live_allocation(client, tickers=None, method=1, book='mvo',
                    horizon='W', h=1, cfg=None):
    """
    Current recommended portfolio for the NEXT period.

    client   : RiskModelsClient. Required unless the pulled df already has a
               'market_cap' column (get_market_cap needs it otherwise).
    tickers  : investable universe. None = full SDK-mapped universe
               (Data.get_tickers()) — heavy, thousands of API calls.
    method   : 1 = SDK sector/subsector triple + growth/size, per-group HMM
                   (forward_moments_m1 — same lineage as the original example)
               2 = Fama-French 5-factor, single global HMM (forward_moments_ff)
    book     : 'mvo'  = tracking-error-budget / max-Sharpe / min-var optimizer
                        against the cap-weighted benchmark (book1_mvo)
               'civp' = correlation-cluster inverse-variance weights, no
                        optimizer (book2_civp)
    horizon  : 'D' / 'W' / 'ME' — data frequency
    h        : how many periods ahead to project (1 = next period)
    cfg      : Config() instance controlling the three forks
               (mvo_objective, corr_source, market_var_mode) plus every
               risk/cost knob. None -> Config() defaults.

    Returns: stock_weights (dict[ticker] -> float), summing to 1.0 over the
    names actually held. Trade this at the next rebalance.
    """
    cfg = cfg or Config()

    # 1. pull + build the (already-orthogonalized) return panel on ALL
    #    available history — no train/test split, this is "as of today".
    df = get_data(tickers, client, method, resample_window=horizon)
    df = df.copy()
    df['date'] = pd.to_datetime(df['date'])
    if 'stock_ret' not in df.columns and 'returns_gross' in df.columns:
        df['stock_ret'] = df['returns_gross']

    # 2. market cap — needed for the cap-weighted benchmark (nu) and, for
    #    method 1, to combine per-group market variance into one s2g.
    if 'market_cap' not in df.columns:
        if client is None:
            raise ValueError(
                "df has no 'market_cap' and no client was passed to fetch it "
                "(forward_beta.get_market_cap needs one)."
            )
        df = get_market_cap(client, df, df['ticker'].unique())

    # 3. annualization + forward regime moments on the full sample
    base_ppy = {'D': 252, 'W': 52, 'ME': 12}.get(horizon, 52)
    cfg.ppy = base_ppy / h

    tickers_out, psi, Omega = forward_moments(df, method, h, cfg)
    if not tickers_out:
        raise ValueError(
            "No tickers came back from forward_moments — universe too "
            "sparse, or not enough history for the regime fit (method 1 "
            "needs >=250 obs/group, method 2 needs >=250 obs total and "
            f">={cfg.min_obs} overlapping obs per stock)."
        )

    caps = df.groupby('ticker')['market_cap'].last().to_dict()

    # 4. book
    if book == 'mvo':
        stock_weights = book1_mvo(tickers_out, psi, Omega, caps, cfg)
    elif book == 'civp':
        realized_cov = None
        if cfg.corr_source == 'realized':
            win_len = cfg.realized_window or (52 if horizon == 'W' else 252)
            realized_cov = _realized_cov(df, tickers_out, win_len)
        stock_weights = book2_civp(tickers_out, Omega, cfg, realized_cov=realized_cov)
    else:
        raise ValueError(f"book must be 'mvo' or 'civp', got {book!r}")

    return stock_weights
