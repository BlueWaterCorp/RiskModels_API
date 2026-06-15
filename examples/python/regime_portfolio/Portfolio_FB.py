
import pandas as pd
from Forward_beta import fit_regime_model
import numpy as np
from scipy.optimize import minimize
from Forward_beta import fit_regime_model, compute_forward_beta

# Certain points for the code : 
# User can't take less than 2 stock per ETF
# Market cap used for backtest is current market cap so there is a survivership bias in the model bactest
# Regime model require large amount of data to identify the Regimes properly so keeping the training period atleast till 2020 is required

def plot_growth(bt):
    import matplotlib.pyplot as plt
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 9), height_ratios=[2, 1])

    # --- top: cumulative growth, all series ---
    ax1.plot(bt['date'], bt['port_growth'],     label='Regime (gross)', linewidth=2)
    ax1.plot(bt['date'], bt['port_growth_net'], label='Regime (net of cost)', linewidth=1.5, linestyle=':')
    ax1.plot(bt['date'], bt['static_growth'],   label='Cap-weight (regimes OFF)', linewidth=1.5)
    ax1.plot(bt['date'], bt['ew_growth'],       label='Equal-weight 1/N', linewidth=1.2, linestyle='-.')
    ax1.plot(bt['date'], bt['spy_growth'],      label='SPY', linewidth=1.2, linestyle='--')
    ax1.set_title('Cumulative Growth of $1'); ax1.set_ylabel('Growth of $1')
    ax1.legend(); ax1.grid(alpha=0.3)

    # --- bottom: drawdown of the regime portfolio vs SPY ---
    def drawdown(g):
        return g / g.cummax() - 1
    ax2.fill_between(bt['date'], drawdown(bt['port_growth']), 0, alpha=0.4, label='Regime drawdown')
    ax2.plot(bt['date'], drawdown(bt['spy_growth']), linewidth=1, linestyle='--', label='SPY drawdown')
    ax2.set_title('Drawdown'); ax2.set_ylabel('Drawdown'); ax2.set_xlabel('Date')
    ax2.legend(); ax2.grid(alpha=0.3)

    plt.tight_layout(); plt.show()

def plot_pi_comparison(bt_on, bt_off):
    """Test 2: does the transition matrix matter? Overlays real-Pi vs neutered-Pi growth."""
    import matplotlib.pyplot as plt
    plt.figure(figsize=(11, 5))
    plt.plot(bt_on['date'],  bt_on['port_growth'],  label='Π ON (real dynamics)', linewidth=2)
    plt.plot(bt_off['date'], bt_off['port_growth'], label='Π OFF (identity)', linewidth=1.5, linestyle='--')
    plt.title('Does the transition matrix matter?')
    plt.xlabel('Date'); plt.ylabel('Growth of $1')
    plt.legend(); plt.grid(alpha=0.3)
    plt.tight_layout(); plt.show()

def static_capweight(group_results, market_caps):
    # regimes-OFF benchmark: hold every stock at its value-weight, NO alpha tilt
    tickers, c = [], []
    for g in group_results:
        for t in group_results[g]['tickers']:
            tickers.append(t); c.append(market_caps[t])
    c = np.array(c, float)
    w = c / c.sum()                          # = nu, the value-weighted benchmark
    return {t: float(w[i]) for i, t in enumerate(tickers)}


def _block_diag(blocks):
    n = sum(b.shape[0] for b in blocks)
    out = np.zeros((n, n)); k = 0
    for b in blocks:
        m = b.shape[0]; out[k:k+m, k:k+m] = b; k += m
    return out


def compute_portfolio_weights(all_fwd, all_thetas, group_hmms, group_map,
                              stock_df_input, h, sigma_bar_sq):
    group_results = {}
    for group_name, hmm_info in group_hmms.items():
        group_tickers = [t for t in group_map[group_name]
                         if t in all_fwd and t in all_thetas]
        if len(group_tickers) < 2:
            continue

        order_g  = hmm_info['order']
        G_g      = hmm_info['G']                 # T x m, regime-ordered
        Pi_g     = hmm_info['Pi']                # m x m, regime-ordered
        Z_orth_g = hmm_info['Z_orth']            # T x 3
        scaler_g = hmm_info['scaler']
        hmm_g    = hmm_info['hmm']

        gamma_t = G_g[-1]                         # (m,) current regime probs
        m       = len(gamma_t)                    # dynamic regime count

        std_g  = scaler_g.scale_                  # (3,)
        mean_g = scaler_g.mean_                   # (3,)

        # unscale per-regime means/covars back to raw factor space, in regime order
        mu_states    = np.array([hmm_g.means_[s] * std_g + mean_g for s in order_g])          # m x 3
        Sigma_states = np.array([np.diag(std_g) @ hmm_g.covars_[s] @ np.diag(std_g)
                                 for s in order_g])                                            # m x 3 x 3

        # eq. 6 — regime-mixed factor mean and covariance
        mu_t    = sum(gamma_t[s] * mu_states[s] for s in range(m))                             # (3,)
        Sigma_t = (sum(gamma_t[s] * (Sigma_states[s] + np.outer(mu_states[s], mu_states[s]))
                       for s in range(m)) - np.outer(mu_t, mu_t))                              # 3 x 3

        # eq. 8 — forward loadings matrix Phi (3 x n)
        n     = len(group_tickers)
        Phi_h = np.column_stack([all_fwd[t] for t in group_tickers])                           # 3 x n

        # eq. 9 — idiosyncratic block Xi (n x n diagonal)
        Pi_h    = np.linalg.matrix_power(Pi_g, h)
        dates_g = hmm_info['dates']
        Xi_diag = np.zeros(n)
        for i, t in enumerate(group_tickers):
            df_t   = stock_df_input[stock_df_input['ticker'] == t].sort_values('date')
            common = np.intersect1d(dates_g, df_t['date'].values)
            if len(common) < 30:
                continue
            x_t  = df_t[df_t['date'].isin(common)]['stock_ret'].values
            Z_c  = Z_orth_g[np.isin(dates_g, common)]
            G_c  = G_g[np.isin(dates_g, common)]
            n_c, k = len(x_t), Z_c.shape[1]
            xi_i = np.zeros((m, m))
            for s in range(m):
                eps_s = Z_c @ all_thetas[t][:, s] - x_t               # Matrix Mul (n, 3) * (3, 1) - (n, 1) 
                xi_i[s, s] = (eps_s @ eps_s) / max(n_c - k, 1)        # variance, not SSR
            Xi_diag[i] = (gamma_t.reshape(1, -1) @ Pi_h @ xi_i @ Pi_h.T
                          @ gamma_t.reshape(-1, 1)).item()
        Xi_t = np.diag(Xi_diag)     # This is defined per sector subsector, (n, n) matrix

        # eq. 9 — projected mean and covariance for the group
        beta_mkt   = Phi_h[0, :]                       # (n,) forward market beta per stock
        sigma2_mkt = Sigma_t[0, 0]                     # this group's regime-mixed market variance

        Omega_full   = Phi_h.T @ Sigma_t @ Phi_h + Xi_t          # full (market + sec + sub + idio), (n,3) * (3,3) * (3,n) + (n,n) 
        Omega_mkt    = np.outer(beta_mkt, beta_mkt) * sigma2_mkt # market-only piece
        Omega_nonmkt = Omega_full - Omega_mkt                    # sector + subsector + idiosyncratic

        psi_t = Phi_h.T @ mu_t                                   # (n,3) * (3,) = (n,)

        group_results[group_name] = {
            'tickers'     : group_tickers,
            'psi'         : psi_t,
            'Omega_nonmkt': Omega_nonmkt,        # within-group, no market (stays block-diagonal)
            'beta_mkt'    : beta_mkt,            # for the universe-wide market term
            'sigma2_mkt'  : sigma2_mkt,         # this group's market variance (largest group wins)
            'n_group'     : n,                  # size, to pick the largest group
        }
    return group_results


def build_S_alpha_weights(group_results, market_caps, sigma_bar_sq):
    group_names = list(group_results.keys())
    tickers, groups, psi_parts, nonmkt_blocks, betam_parts = [], [], [], [], []
    big_name, big_n = None, -1
    for g in group_names:
        res = group_results[g]  # Get the data grom group_results 
        tickers      += list(res['tickers'])   # Get ticker from each sector subsector combination, add to tikcers and form a long list of tickers 
        groups       += [g] * len(res['tickers'])   # Repeast the group name numbre of times as the number of ticker count in the group_results
        psi_parts    .append(np.asarray(res['psi']).ravel())
        nonmkt_blocks.append(np.asarray(res['Omega_nonmkt']))
        betam_parts  .append(np.asarray(res['beta_mkt']).ravel())
        if res['n_group'] > big_n:                 # track largest group
            big_n, big_name = res['n_group'], g

    n, q = len(tickers), len(group_names)
    psi      = np.concatenate(psi_parts)                       # (n,)
    beta_mkt = np.concatenate(betam_parts)                     # (n,) market beta, whole universe
    sigma2_mkt = group_results[big_name]['sigma2_mkt']        # ONE universe market variance

    # Level-2 Omega: block-diagonal non-market  +  full universe-wide market term
    Omega = _block_diag(nonmkt_blocks)                        # (n,n) within-group, no market
    Omega = Omega + np.outer(beta_mkt, beta_mkt) * sigma2_mkt # add market across ALL stocks
    # ---- S : cap-weight within each group (eq. 10) ----
    c = np.array([market_caps[t] for t in tickers], float)     # (n,) caps, universe order
    gidx = {g: j for j, g in enumerate(group_names)}
    Q = np.zeros((n, q))
    for i, g in enumerate(groups):
        Q[i, gidx[g]] = 1.0
    group_cap = Q.T @ c                                          # (q,) total cap per group
    S = (c[:, None] * Q) / group_cap[None, :]                   # (n,q) col j = cap-wts in group j

    nu = c / c.sum()                                            # (n,) value-weighted benchmark

    # ---- optimize alpha : max psi^T S a  s.t. TE, fully invested, long-only ----
    def neg_ret(a):  return -(psi @ (S @ a))
    cons = [
        {'type': 'eq',   'fun': lambda a: (S @ a).sum() - 1.0},
        {'type': 'ineq', 'fun': lambda a: sigma_bar_sq - (S @ a - nu) @ Omega @ (S @ a - nu)},
    ]
    res = minimize(neg_ret, np.ones(q), method='SLSQP',
                   bounds=[(0, None)] * q,                       # alpha >= 0  => w >= 0
                   constraints=cons, options={'ftol': 1e-10, 'maxiter': 1000})

    w = S @ res.x
    w = np.clip(w, 0, None); w = w / w.sum()

    stock_weights = {t: float(w[i]) for i, t in enumerate(tickers)}
    group_weights = {g: float((S @ res.x)[np.array(groups) == g].sum()) for g in group_names}
    return stock_weights, group_weights


def portfolio_backtest(train, test, regimes, forward, horizon='W', kill_pi=None):
    rebal_dates = sorted(test['date'].unique())[::forward]
    base_ppy = {'D': 252, 'W': 52, 'ME': 12}.get(horizon, 52)   
    ppy = base_ppy / forward
    sigma_bar_sq = (0.04 ** 2) / ppy

    rows = []                                                    # <-- accumulate per-window results
    for i, rebal in enumerate(rebal_dates[:-1]):
        train_window = pd.concat([train, test[test['date'] < rebal]])

        all_thetas, group_hmms, group_map = fit_regime_model(train_window, regimes)
        if not group_hmms:
            continue
        all_fwd = compute_forward_beta(all_thetas, group_hmms, group_map,
                                       h=forward, kill_pi=kill_pi)
        group_results = compute_portfolio_weights(all_fwd, all_thetas, group_hmms,
                                                  group_map, train_window,
                                                  h=forward, sigma_bar_sq=sigma_bar_sq)
        if not group_results:
            continue
        caps = train_window.groupby('ticker')['market_cap'].last().to_dict()
        stock_w, group_a = build_S_alpha_weights(group_results, caps, sigma_bar_sq)

        # ---- score: hold weights from rebal to next rebalance, vs SPY ----
        nxt  = rebal_dates[i + 1]
        hold = test[(test['date'] > rebal) & (test['date'] <= nxt)]

        port = 0.0
        for t, wt in stock_w.items():
            r = hold[hold['ticker'] == t]['stock_ret'].values
            if len(r):
                port += wt * ((1 + r).prod() - 1)               # compounded stock return over window
        spy = (1 + hold.drop_duplicates('date')['market_ret'].values).prod() - 1

        # regimes-OFF cap-weight (Test 1)
        static_w = static_capweight(group_results, caps)
        stat = 0.0
        for t, wt in static_w.items():
            r = hold[hold['ticker'] == t]['stock_ret'].values
            if len(r):
                stat += wt * ((1 + r).prod() - 1)

        # equal-weight benchmark on the SAME names (Test 3a)
        ew_names = list(stock_w)
        ew = 0.0
        for t in ew_names:
            r = hold[hold['ticker'] == t]['stock_ret'].values
            if len(r):
                ew += (1.0 / len(ew_names)) * ((1 + r).prod() - 1)

        # turnover cost on the regime portfolio (Test 3b)
        prev_w = rows[-1]['stock_w'] if rows else {}
        names  = set(stock_w) | set(prev_w)
        turnover = sum(abs(stock_w.get(t, 0) - prev_w.get(t, 0)) for t in names)
        COST_BPS = 10
        cost = turnover * COST_BPS / 10000

        rows.append({'date': nxt, 'port_ret': port, 'port_ret_net': port - cost,
                     'static_ret': stat, 'ew_ret': ew, 'spy_ret': spy,
                     'turnover': turnover, 'stock_w': stock_w, 'group_w': group_a})
        print(f"{nxt.date()} | port={port:+.3%}  net={port-cost:+.3%}  "
              f"spy={spy:+.3%}  ew={ew:+.3%}")

    bt = pd.DataFrame(rows)
    bt['port_growth']     = (1 + bt['port_ret']).cumprod()       # growth of $1
    bt['port_growth_net'] = (1 + bt['port_ret_net']).cumprod()   # after transaction cost
    bt['spy_growth']      = (1 + bt['spy_ret']).cumprod()
    bt['static_growth']   = (1 + bt['static_ret']).cumprod()     # regimes-OFF cap-weight
    bt['ew_growth']       = (1 + bt['ew_ret']).cumprod()         # equal-weight 1/N
    return bt

def backtest_result_HMM(data, split='2020-01-01', regimes=2, forward=1, horizon='W', kill_pi=None):
    data = data.copy()
    data['date'] = pd.to_datetime(data['date'])
    split = pd.Timestamp(split)
    train = data[data['date'] <  split]
    test  = data[data['date'] >= split]
    bt = portfolio_backtest(train, test, regimes, forward, horizon=horizon, kill_pi=kill_pi)       
    plot_growth(bt)
    return bt

