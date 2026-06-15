
import os
import pandas as pd
from numpy.linalg import lstsq
from sklearn.preprocessing import StandardScaler
from hmmlearn.hmm import GaussianHMM
import numpy as np
import pandas as pd




# WARNING: This downloads 3000+ tickers and will consume significant API credits.
# Run once and save to parquet. Do not re-run unnecessarily.
def get_data(client, tickers):
    

    # rebuild a split-adjusted price from returns_gross (price_close is NOT split-adjusted)
    def adj_price(sym, col):
        df = client.get_ticker_returns(sym, years=15)[['date', 'returns_gross']].copy()
        df = df.sort_values('date')
        df[col] = (1 + df['returns_gross'].fillna(0)).cumprod()
        return df[['date', col]]

    all_returns = []
    spy_df = adj_price('SPY', 'market_price')

    etf_cache = {}
    def etf_prices(sym, col):
        if sym not in etf_cache:
            etf_cache[sym] = adj_price(sym, '_p')         # cache the raw adjusted price once
        return etf_cache[sym].rename(columns={'_p': col})

    for t in tickers:
        try:
            d = client.decompose(t)
            sec_etf = d['exposure']['sector']['hedge_etf']
            sub_etf = d['exposure']['subsector']['hedge_etf']
            if sec_etf is None or sub_etf is None:
                print(f"[get_data] {t}: missing ETF, skipped"); continue

            df = adj_price(t, 'price_close')
            df['ticker'] = t
            df['sector_etf'] = sec_etf
            df['subsector_etf'] = sub_etf
            df = df.merge(etf_prices(sec_etf, 'sector_price'),    on='date', how='left')
            df = df.merge(etf_prices(sub_etf, 'subsector_price'), on='date', how='left')
            df = df.merge(spy_df, on='date', how='left')
            all_returns.append(df)
        except Exception as e:
            print(f"[get_data] {t}: failed ({e!r}), skipped")
            continue
    prices_df = pd.concat(all_returns).reset_index(drop=True)
    return prices_df

def create_returns(prices_df, horizon='W'):
    """
    horizon: 'D' daily, 'W' weekly, 'ME' monthly
    """
    prices_df = prices_df.copy()
    prices_df['date'] = pd.to_datetime(prices_df['date'])

    out = []
    for t, g in prices_df.groupby('ticker'):
        r = g.set_index('date').resample(horizon).last()
        r['ticker'] = t                      
        out.append(r.reset_index())
    resampled = pd.concat(out, ignore_index=True)

    resampled['stock_ret']     = resampled.groupby('ticker')['price_close'].pct_change(fill_method=None)
    resampled['sector_ret']    = resampled.groupby('ticker')['sector_price'].pct_change(fill_method=None)
    resampled['subsector_ret'] = resampled.groupby('ticker')['subsector_price'].pct_change(fill_method=None)
    resampled['market_ret']    = resampled.groupby('ticker')['market_price'].pct_change(fill_method=None)

    resampled = resampled.dropna()
    resampled = resampled.drop(columns=['sector_price', 'subsector_price',
                                        'price_close', 'market_price'])
    return resampled

# This only uses the current snapshot of the marketcap and not the historic one
def get_market_cap(client, resampled, tickers):
    for t in resampled['ticker'].unique():          
        try:
            m = client.get_metrics(t, as_dataframe=True)[['teo','market_cap']]
            if m.empty:
                print(f"[get_market_cap] {t}: no metrics, skipped"); continue
            cap = m.sort_values('teo')['market_cap'].iloc[-1]
            resampled.loc[resampled['ticker'] == t, 'market_cap'] = cap
        except Exception as e:
            print(f"[get_market_cap] {t}: failed ({e!r}), skipped")
            continue
    return resampled

def fit_regime_model(stock_df_input,regimes):
    group_map = (stock_df_input
                 .groupby(['sector_etf','subsector_etf'])['ticker']
                 .unique()
                 .to_dict())
    group_map = {f"{k[0]}_{k[1]}": list(v) for k, v in group_map.items()}

    all_thetas = {}
    group_hmms = {}

    for group_name, group_tickers in group_map.items():
        grp_df = stock_df_input[stock_df_input['ticker'].isin(group_tickers)].copy()

        df_g = (grp_df.drop_duplicates('date')
              .sort_values('date').reset_index(drop=True))

        if len(df_g) < 250:
            continue

        Z_g = df_g[['market_ret','sector_ret','subsector_ret']].values
        mkt_g     = Z_g[:,0].reshape(-1,1)
        sec_o_g   = Z_g[:,1] - mkt_g.ravel()*lstsq(mkt_g,Z_g[:,1],rcond=None)[0][0]
        mkt_sec_g = np.column_stack([mkt_g, sec_o_g])
        sub_o_g   = Z_g[:,2] - mkt_sec_g @ lstsq(mkt_sec_g,Z_g[:,2],rcond=None)[0]
        Z_orth_g  = np.column_stack([mkt_g, sec_o_g, sub_o_g])

        scaler_g   = StandardScaler()
        Z_scaled_g = scaler_g.fit_transform(Z_orth_g)

        best = None 
        best_converged = None

        for seed in range(10):
            h = GaussianHMM(n_components=regimes, covariance_type='diag',
                             n_iter=2000, random_state=seed , tol=1e-4, min_covar=1e-3)
            h.fit(Z_scaled_g)
            if h.monitor_.converged:
                if best_converged is None or h.score(Z_scaled_g)>best_converged.score(Z_scaled_g):
                    best_converged = h
            if best is None or h.score(Z_scaled_g) > best.score(Z_scaled_g):
                best = h

        if best_converged is not None:
            hmm_g = best_converged
        else:
            hmm_g = best
            print(f"[fit_regime_model] {group_name}: no seed converged — regime probs unreliable")

        # --- BIC for this fit (lower = better; helps user judge the chosen regime count) ---
        logL    = hmm_g.score(Z_scaled_g)
        T_obs   = Z_scaled_g.shape[0]
        k_feat  = Z_scaled_g.shape[1]
        # free params (diag covariance): means r*k + diag covars r*k + transmat r*(r-1) + startprob (r-1)
        n_params = regimes * k_feat + regimes * k_feat + regimes * (regimes - 1) + (regimes - 1)
        bic = -2 * logL + n_params * np.log(T_obs)
        print(f"[fit_regime_model] {group_name}: regimes={regimes}  BIC={bic:.1f}  logL={logL:.1f}")

        row_sums = hmm_g.transmat_.sum(axis=1)
        dead_regimes = np.where(~np.isclose(row_sums, 1.0))[0]
        if len(dead_regimes) > 0:
            print(f"[fit_regime_model] {group_name}: regime(s) {dead_regimes.tolist()} "
                  f"never observed — too few data points for {regimes} regimes. Skipping group.")
            continue

        G_full    = hmm_g.predict_proba(Z_scaled_g)          
        occupancy = G_full.sum(axis=0)                       
        MIN_OBS   = 5                                         
        thin = np.where(occupancy < MIN_OBS)[0]
        if len(thin) > 0:
            print(f"[fit_regime_model] {group_name}: regime(s) {thin.tolist()} have "
                  f"effective occupancy {occupancy[thin].round(2).tolist()} (< {MIN_OBS}) — "
                  f"beta for these regimes is estimated on almost no data and is unreliable.")
            # NOTE: this WARNS and continues. It does NOT skip the group.


        means_g  = hmm_g.means_[:, 0]
        vars_g   = np.array([hmm_g.covars_[s][0,0] for s in range(regimes)])
        sharpe_g = means_g / np.sqrt(vars_g)
        order_g  = np.argsort(sharpe_g).tolist()

        G_g  = hmm_g.predict_proba(Z_scaled_g)[:, order_g]
        Pi_g = hmm_g.transmat_[order_g][:, order_g]

        viterbi_raw = hmm_g.predict(Z_scaled_g)
        order_inv   = np.argsort(order_g)
        viterbi_g   = order_inv[viterbi_raw]

        group_hmms[group_name] = {
            'hmm'       : hmm_g,
            'order'     : order_g,
            'G'         : G_g,
            'Pi'        : Pi_g,
            'Z_orth'    : Z_orth_g,
            'scaler'    : scaler_g,
            'dates'     : df_g['date'].values,
            'viterbi'   : viterbi_g
        }

        k_t = Z_orth_g.shape[1]
        for t in group_tickers:
            df_t = grp_df[grp_df['ticker']==t].sort_values('date').reset_index(drop=True)
            if len(df_t) < 30:
                continue
            common_dates = np.intersect1d(df_g['date'].values, df_t['date'].values)
            if len(common_dates) < 30:
                continue

            Z_t = Z_orth_g[np.isin(df_g['date'].values, common_dates)]
            x_t = df_t[df_t['date'].isin(common_dates)]['stock_ret'].values
            G_t = G_g[np.isin(df_g['date'].values, common_dates)]

            Theta_t = np.zeros((k_t, regimes))
            for s in range(regimes):
                w             = G_t[:, s]
                A             = Z_t.T @ np.diag(w) @ Z_t + 1e-4*np.eye(k_t)
                b             = Z_t.T @ (w * x_t)
                Theta_t[:, s] = np.linalg.solve(A, b)

            all_thetas[t] = Theta_t

    print(f"\nTotal stocks fitted: {len(all_thetas)}")
    return all_thetas, group_hmms, group_map

def compute_forward_beta(all_thetas, group_hmms, group_map, h=4, kill_pi=None):
    all_fwd = {}

    for group_name, hmm_info in group_hmms.items():
        Pi_g       = hmm_info['Pi']
        G_g        = hmm_info['G']
        order_g    = hmm_info['order']
        m          = Pi_g.shape[0]

        if kill_pi == 'identity':
            Pi_g = np.eye(m)                 
        elif kill_pi == 'uniform':
            Pi_g = np.ones((m, m)) / m        

        gamma_last = G_g[-1].reshape(1, -1)
        Pi_h       = np.linalg.matrix_power(Pi_g, h)

        for t, Theta_t in all_thetas.items():
            if t not in [tk for gn, tks in group_map.items()
                         for tk in tks if gn == group_name]:
                continue

            theta_fwd  = gamma_last @ Pi_h @ Theta_t.T
            all_fwd[t] = theta_fwd.ravel()

    return all_fwd


def get_forward_beta(horizon,forward, client, tickers = None, regimes = 2):
    if tickers is None:
        tickers = client.search_tickers()['ticker'].tolist()
    prices_df = get_data(client, tickers)
    resampled = create_returns(prices_df,horizon)

    # Get market cap for further portfolio construction
    resampled = get_market_cap(client, resampled, tickers)
    all_thetas, group_hmms, group_map = fit_regime_model(resampled,regimes)
    all_fwd = compute_forward_beta(all_thetas, group_hmms,group_map, forward)

    return all_thetas, group_hmms, group_map, resampled, all_fwd

def show_forward_beta(all_fwd,n):
    fwd_df = pd.DataFrame(all_fwd, index=['β_market','β_sector','β_subsector']).T
    print(f"Total stocks with forward beta: {len(fwd_df)}")
    print(fwd_df.head(n))