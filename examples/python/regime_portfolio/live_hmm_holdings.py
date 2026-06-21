# live_hmm_holdings.py — next-period target weights for live trading (no train/test split, no scoring)
import pandas as pd
from .forward_beta import (get_data, create_returns, get_market_cap,
                          fit_regime_model, compute_forward_beta)
from .portfolio_fb import compute_portfolio_weights, build_S_alpha_weights


def live_allocation(client, tickers, horizon='W', h=1, regimes=2):
    """
    Current recommended portfolio for the NEXT period.
    horizon : 'D' / 'W' / 'ME'  — data frequency
    h       : how many periods ahead to project (1 = next period)
    Returns (stock_weights, group_weights) to trade today.
    """
    # 1. pull + build returns on ALL data up to today (no train/test split)
    prices    = get_data(client, tickers)
    resampled = create_returns(prices, horizon)
    resampled = get_market_cap(client, resampled, tickers)

    # 2. fit regime model on the full history
    all_thetas, group_hmms, group_map = fit_regime_model(resampled, regimes)
    if not group_hmms:
        raise ValueError("No groups fitted — check universe / data length.")

    # 3. forward beta h periods ahead, then portfolio ingredients
    all_fwd = compute_forward_beta(all_thetas, group_hmms, group_map, h=h)
    base_ppy = {'D': 252, 'W': 52, 'ME': 12}.get(horizon, 52)   
    ppy = base_ppy / h
    sigma_bar_sq = (0.04 ** 2) / ppy
    group_results = compute_portfolio_weights(all_fwd, all_thetas, group_hmms,
                                              group_map, resampled,
                                              h=h, sigma_bar_sq=sigma_bar_sq)
    if not group_results:
        raise ValueError("No group results — universe too sparse for optimization.")

    # 4. final weights
    caps = resampled.groupby('ticker')['market_cap'].last().to_dict()
    stock_weights, group_weights = build_S_alpha_weights(group_results, caps, sigma_bar_sq)

    return stock_weights, group_weights
