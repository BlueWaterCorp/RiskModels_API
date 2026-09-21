import numpy as np
import pandas as pd
from numpy.linalg import lstsq
from sklearn.preprocessing import StandardScaler
from hmmlearn.hmm import GaussianHMM


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
    
    if 'market_cap' not in resampled.columns:
        raise ValueError(
            "get_market_cap: no market cap fetched for ANY ticker — cannot cap-weight. "
            "Check API credentials / universe."
        )
    bad = resampled.loc[resampled['market_cap'].isna(), 'ticker'].unique().tolist()
    if bad:
        print(f"[get_market_cap] dropping {len(bad)} ticker(s) with no market cap: {bad}")
        resampled = resampled[~resampled['market_cap'].isna()].reset_index(drop=True)
    return resampled

def fit_regime_model(stock_df_input,regimes,verbose=False):
    # verbose=False silences the per-group fit chatter (BIC / regime diagnostics /
    # "Total stocks fitted"). The backtest calls this once per expanding window, so leaving
    # it on floods the log; pass verbose=True only when you want the per-fit detail.
    group_map = (stock_df_input
                 .groupby(['sector','subsector'])['ticker']
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

        # orthogonalization done upstream — pull the residual columns directly
        Z_orth_g = df_g[['market_ret','sector_o','subsector_o','growth_o','size_o']].values

        

        scaler_g   = StandardScaler()
        Z_scaled_g = scaler_g.fit_transform(Z_orth_g)  # HMM sees core + macro

        best = None 
        best_converged = None

        for seed in range(10):
            h = GaussianHMM(n_components=regimes, covariance_type='full',
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
            if verbose:
                print(f"[fit_regime_model] {group_name}: no seed converged — regime probs unreliable")

        # --- BIC for this fit (lower = better; helps user judge the chosen regime count) ---
        logL    = hmm_g.score(Z_scaled_g)
        T_obs   = Z_scaled_g.shape[0]
        k_feat  = Z_scaled_g.shape[1]
        # free params (diag covariance): means r*k + diag covars r*k + transmat r*(r-1) + startprob (r-1)
        n_params = regimes * k_feat + regimes * k_feat * (k_feat + 1) // 2 + regimes * (regimes - 1) + (regimes - 1)
        bic = -2 * logL + n_params * np.log(T_obs)
        if verbose:
            print(f"[fit_regime_model] {group_name}: regimes={regimes}  BIC={bic:.1f}  logL={logL:.1f}")

        row_sums = hmm_g.transmat_.sum(axis=1)
        dead_regimes = np.where(~np.isclose(row_sums, 1.0))[0]
        if len(dead_regimes) > 0:
            if verbose:
                print(f"[fit_regime_model] {group_name}: regime(s) {dead_regimes.tolist()} "
                      f"never observed — too few data points for {regimes} regimes. Skipping group.")
            continue

        G_full    = hmm_g.predict_proba(Z_scaled_g)          
        occupancy = G_full.sum(axis=0)                       
        MIN_OBS   = 5                                         
        thin = np.where(occupancy < MIN_OBS)[0]
        if len(thin) > 0 and verbose:
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

        # ================= REGIME DIAGNOSTICS (per group, per rebalance) =================
        m = regimes
        # (1) posterior confidence: normalized entropy per week, 0=certain 1=coin-flip
        ent = -(G_g * np.log(G_g + 1e-12)).sum(1) / np.log(m)
        # (2) current regime call (last observation) — what we'd act on this rebalance
        g_last = G_g[-1]
        # (3) persistence: how sticky each regime is (diagonal of Pi, ordered low->high Sharpe)
        pi_diag = np.diag(Pi_g)
        # (4) economic separation: mean & vol of MARKET feature per regime (raw, unscaled)
        hard   = G_g.argmax(1)
        mkt_raw = Z_orth_g[:, 0]                       # column 0 = market_ret, unscaled
        reg_mean = [mkt_raw[hard == s].mean() if (hard == s).any() else np.nan for s in range(m)]
        reg_vol  = [mkt_raw[hard == s].std()  if (hard == s).any() else np.nan for s in range(m)]
        # (5) recency: how decisive is the LAST call, and how far did it move from prior week
        conf_last  = 1 - ent[-1]                       # 1=fully decisive now
        g_prev     = G_g[-2] if len(G_g) > 1 else g_last
        gamma_move = np.abs(g_last - g_prev).max()     # did the regime call shift this week?

        if verbose:
            print(f"[regime] {group_name}: "
                  f"γ_last={np.round(g_last,2)}  conf={conf_last:.2f}  Δγ={gamma_move:.2f} | "
                  f"mean_ent={ent.mean():.2f} frac_conf={np.mean(ent<0.3):.2f} | "
                  f"Pi_diag={np.round(pi_diag,2)} | "
                  f"reg_mean={np.round(reg_mean,4)} reg_vol={np.round(reg_vol,4)}")
        # =================================================================================

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

    if verbose:
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

        group_members = set(group_map[group_name]) 
        for t, Theta_t in all_thetas.items():
            if t not in group_members:
                continue

            theta_fwd  = gamma_last @ Pi_h @ Theta_t.T
            all_fwd[t] = theta_fwd.ravel()

    return all_fwd


def get_forward_beta(horizon,forward, client, tickers = None, regimes = 2):
    

    # Get market cap for further portfolio construction
    resampled = get_market_cap(client, resampled, tickers)
    all_thetas, group_hmms, group_map = fit_regime_model(resampled,regimes)
    all_fwd = compute_forward_beta(all_thetas, group_hmms,group_map, forward)

    return all_thetas, group_hmms, group_map, resampled, all_fwd

def show_forward_beta(all_fwd,n):
    fwd_df = pd.DataFrame(all_fwd,index=['β_market','β_sector','β_subsector','β_growth','β_size']).T
    print(f"Total stocks with forward beta: {len(fwd_df)}")
    print(fwd_df.head(n))
