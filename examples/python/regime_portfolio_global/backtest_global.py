
from dataclasses import dataclass, field
import numpy as np
import pandas as pd
from scipy.optimize import minimize


@dataclass
class Config:
    # --- the three design forks (see header) ---
    market_var_mode: str = 'largest'      # 'largest' | 'capw' | 'mean'   (method 1)
    mvo_objective:   str = 'te_budget'    # 'te_budget' | 'max_sharpe' | 'min_var'
    corr_source:     str = 'omega'        # 'omega' | 'realized'          (book 2)

    # --- optimizer / risk ---
    te_vol_annual:   float = 0.04         # tracking-error budget (annual vol) for te_budget
    risk_aversion:   float = 5.0          # lambda for max_sharpe objective
    long_only:       bool  = True

    # --- book 2 clustering ---
    corr_threshold:  float = 0.5
    max_clusters:    int   = None
    realized_window: int   = None         # None -> 52 (W) / 252 (D)

    # --- regime model ---
    regimes:         int   = 2
    kill_pi:         str   = None         # None | 'identity' | 'uniform'  (method 1)
    n_seeds:         int   = 8            # method-2 global HMM restarts
    n_iter:         int    = 1000         # method-2 global HMM EM iters
    min_obs:         int   = 30           # min overlapping obs to load a stock (method 2)

    # --- costs / mechanics ---
    cost_bps:        float = 10.0         # per unit turnover, per rebalance
    ridge:           float = 1e-10        # PSD ridge added to Omega

    # filled at runtime
    ppy:             float = field(default=52.0)


def _block_diag(blocks):
    n = sum(b.shape[0] for b in blocks)
    out = np.zeros((n, n)); k = 0
    for b in blocks:
        m = b.shape[0]; out[k:k + m, k:k + m] = b; k += m
    return out


def _psd(A, ridge=1e-10):
   
    A = np.asarray(A, float)
    A = 0.5 * (A + A.T)
    A = A + ridge * np.eye(A.shape[0])
    w, V = np.linalg.eigh(A)
    if (w < 0).any():
        w = np.clip(w, 0.0, None)
        A = (V * w) @ V.T
        A = 0.5 * (A + A.T)
    return A


def _corr_from_cov(cov):
    d = np.sqrt(np.clip(np.diag(cov), 1e-18, None))
    C = cov / np.outer(d, d)
    np.fill_diagonal(C, 1.0)
    return np.clip(C, -1.0, 1.0)



def forward_moments_m1(win, h, cfg):
    
    from forward_beta import fit_regime_model, compute_forward_beta
    from portfolio_fb import compute_portfolio_weights

    sbs = (cfg.te_vol_annual ** 2) / cfg.ppy
    all_thetas, group_hmms, group_map = fit_regime_model(win, cfg.regimes)
    if not group_hmms:
        return [], None, None
    all_fwd = compute_forward_beta(all_thetas, group_hmms, group_map, h=h, kill_pi=cfg.kill_pi)
    gr = compute_portfolio_weights(all_fwd, all_thetas, group_hmms, group_map,
                                   win, h=h, sigma_bar_sq=sbs)
    if not gr:
        return [], None, None

    caps = win.groupby('ticker')['market_cap'].last().to_dict()
    tickers, psi_parts, blocks = [], [], []
    beta_parts, s2m, ng, capg = [], [], [], []
    for g, res in gr.items():
        tk = list(res['tickers'])
        Om = np.asarray(res['Omega_full'], float)
        bm = np.asarray(res['beta_mkt'], float).ravel()
        s2 = float(res['sigma2_mkt'])
        nonmkt = Om - s2 * np.outer(bm, bm)          # strip the within-group market contribution
        tickers += tk
        psi_parts.append(np.asarray(res['psi'], float).ravel())
        blocks.append(nonmkt)
        beta_parts.append(bm)
        s2m.append(s2); ng.append(len(tk))
        capg.append(sum(caps.get(t, 0.0) for t in tk))

    psi = np.concatenate(psi_parts)
    beta_all = np.concatenate(beta_parts)

    # ONE universe-wide market variance
    if cfg.market_var_mode == 'largest':
        s2g = s2m[int(np.argmax(ng))]
    elif cfg.market_var_mode == 'capw':
        wts = np.maximum(np.asarray(capg, float), 1e-12)
        s2g = float(np.average(s2m, weights=wts))
    else:  # 'mean'
        s2g = float(np.mean(s2m))

    Omega = _block_diag(blocks) + s2g * np.outer(beta_all, beta_all)
    return tickers, psi, _psd(Omega, cfg.ridge)



def forward_moments_ff(win, h, cfg):
    
    from sklearn.preprocessing import StandardScaler
    from hmmlearn.hmm import GaussianHMM

    F = ['Mkt-RF', 'SMB', 'HML', 'RMW', 'CMA']
    fac = (win.drop_duplicates('date').set_index('date')[F].sort_index().dropna())
    if len(fac) < 250:
        return [], None, None
    Zdates = fac.index.values
    Z = fac.values
    scaler = StandardScaler().fit(Z)
    Zs = scaler.transform(Z)

    best = None
    for seed in range(cfg.n_seeds):
        hm = GaussianHMM(n_components=cfg.regimes, covariance_type='full',
                         n_iter=cfg.n_iter, random_state=seed, tol=1e-4, min_covar=1e-3)
        hm.fit(Zs)
        if best is None or hm.score(Zs) > best.score(Zs):
            best = hm
    hm = best
    m = cfg.regimes
    G = hm.predict_proba(Zs)                              # (T, m)
    gamma_t = G[-1]
    Pi = hm.transmat_
    if cfg.kill_pi == 'identity':
        Pi = np.eye(m)
    elif cfg.kill_pi == 'uniform':
        Pi = np.ones((m, m)) / m
    Pi_h = np.linalg.matrix_power(Pi, h)

    std, mean = scaler.scale_, scaler.mean_
    mu_s = np.array([hm.means_[s] * std + mean for s in range(m)])                  # (m,5)
    Sig_s = np.array([np.diag(std) @ hm.covars_[s] @ np.diag(std) for s in range(m)])  # (m,5,5)
    mu_t = sum(gamma_t[s] * mu_s[s] for s in range(m))                              # (5,)
    Sigma_t = (sum(gamma_t[s] * (Sig_s[s] + np.outer(mu_s[s], mu_s[s])) for s in range(m))
               - np.outer(mu_t, mu_t))                                             # (5,5)

    Zdf = pd.DataFrame(Z, index=Zdates, columns=F)
    Gdf = pd.DataFrame(G, index=Zdates)

    tickers, phis, xis = [], [], []
    for t, g in win.groupby('ticker'):
        s = g.dropna(subset=['stock_ret']).drop_duplicates('date').set_index('date')['stock_ret']
        common = Zdf.index.intersection(s.index)
        if len(common) < cfg.min_obs:
            continue
        Zc = Zdf.loc[common].values
        xc = s.loc[common].values
        Gc = Gdf.loc[common].values
        Th = np.zeros((5, m))
        for st in range(m):
            W = Gc[:, st]
            A = Zc.T @ (Zc * W[:, None]) + 1e-6 * np.eye(5)   # regime-weighted normal equations
            b = Zc.T @ (W * xc)
            Th[:, st] = np.linalg.solve(A, b)
        phi_fwd = (gamma_t @ Pi_h @ Th.T).ravel()             # (5,)  forward loadings
        xi = np.zeros((m, m))
        for st in range(m):
            eps = Zc @ Th[:, st] - xc
            xi[st, st] = (eps @ eps) / max(len(xc) - 5, 1)    # per-state residual variance
        xi_i = float(gamma_t @ Pi_h @ xi @ Pi_h.T @ gamma_t)  # regime-mixed idiosyncratic var
        tickers.append(t); phis.append(phi_fwd); xis.append(xi_i)

    if not tickers:
        return [], None, None
    Phi = np.column_stack(phis)                               # (5, n)
    psi = Phi.T @ mu_t                                        # (n,)
    Omega = Phi.T @ Sigma_t @ Phi + np.diag(xis)              # (n, n) dense
    return tickers, np.asarray(psi, float), _psd(Omega, cfg.ridge)


def forward_moments(win, method, h, cfg):
    return forward_moments_m1(win, h, cfg) if method == 1 else forward_moments_ff(win, h, cfg)


def book1_mvo(tickers, psi, Omega, caps, cfg):
    n = len(tickers)
    c = np.array([caps.get(t, 0.0) for t in tickers], float)
    nu = c / c.sum() if c.sum() > 0 else np.ones(n) / n        # cap-weighted benchmark
    Om = _psd(Omega, cfg.ridge)

    if cfg.mvo_objective == 'min_var':
        obj = lambda w, Om=Om: w @ Om @ w
    elif cfg.mvo_objective == 'max_sharpe':
        lam = cfg.risk_aversion
        obj = lambda w, Om=Om, psi=psi, lam=lam: -(psi @ w) + 0.5 * lam * (w @ Om @ w)
    else:  # te_budget (paper eq.10)
        obj = lambda w, psi=psi: -(psi @ w)

    cons = [{'type': 'eq', 'fun': lambda w: w.sum() - 1.0}]
    if cfg.mvo_objective == 'te_budget':
        sbar = (cfg.te_vol_annual ** 2) / cfg.ppy
        cons.append({'type': 'ineq',
                     'fun': lambda w, Om=Om, nu=nu, sbar=sbar: sbar - (w - nu) @ Om @ (w - nu)})

    bnds = [(0.0, None)] * n if cfg.long_only else [(None, None)] * n
    res = minimize(obj, nu.copy(), method='SLSQP', bounds=bnds, constraints=cons,
                   options={'ftol': 1e-10, 'maxiter': 1000})
    w = res.x
    if cfg.long_only:
        w = np.clip(w, 0.0, None)
    s = w.sum()
    w = w / s if s != 0 else nu
    return {t: float(w[i]) for i, t in enumerate(tickers)}



def book2_civp(tickers, Omega, cfg, realized_cov=None):
    from cluster_ivp import cluster_ivp_weights
    Om = _psd(Omega, cfg.ridge)
    if cfg.corr_source == 'realized' and realized_cov is not None:
        # variance from Omega, correlation from the realized window
        d = np.sqrt(np.clip(np.diag(Om), 1e-18, None))
        C = _corr_from_cov(realized_cov)
        Om = np.outer(d, d) * C
    w = cluster_ivp_weights(Om, corr_threshold=cfg.corr_threshold,
                            max_clusters=cfg.max_clusters)      # returns w (array)
    return {t: float(w[i]) for i, t in enumerate(tickers)}


def _realized_cov(win, tickers, window):
    """Sample covariance of stock_ret over the last `window` dates, in ticker order."""
    wide = (win.pivot_table(index='date', columns='ticker', values='stock_ret', aggfunc='last')
               .reindex(columns=tickers).sort_index())
    wide = wide.tail(window)
    cov = wide.cov().reindex(index=tickers, columns=tickers).values
    cov = np.nan_to_num(cov, nan=0.0)
    var = np.nanvar(wide.values, axis=0)
    di = np.diag_indices_from(cov)
    cov[di] = np.where(np.isfinite(var) & (var > 0), var, np.nanmedian(var[var > 0]) if (var > 0).any() else 1e-6)
    return cov



def backtest_global(df, method=1, resample_window='W', book='mvo',
                    split_start='2013-01-01', forward=1, cfg=None,
                    client=None, verbose=True):
   
    cfg = cfg or Config()
    df = df.copy()
    df['date'] = pd.to_datetime(df['date'])
    if 'stock_ret' not in df.columns and 'returns_gross' in df.columns:
        df['stock_ret'] = df['returns_gross']

    if 'market_cap' not in df.columns:
        if client is not None:
            from forward_beta import get_market_cap
            df = get_market_cap(client, df, df['ticker'].unique())
        else:
            raise ValueError("df has no 'market_cap'. Run forward_beta.get_market_cap "
                             "first, or pass client= so it can be fetched.")

    base_ppy = {'D': 252, 'W': 52, 'ME': 12}.get(resample_window, 52)
    cfg.ppy = base_ppy / forward
    win_len = cfg.realized_window or (52 if resample_window == 'W' else 252)

    split = pd.Timestamp(split_start)
    train = df[df['date'] < split]
    test = df[df['date'] >= split]
    if test.empty:
        raise ValueError(f"No data on/after {split_start}.")
    rebal_dates = sorted(test['date'].unique())[::forward]

    cost = cfg.cost_bps / 10000.0
    rows, prev_w = [], {}

    for i, rebal in enumerate(rebal_dates[:-1]):
        win = pd.concat([train, test[test['date'] < rebal]])       # expanding
        tickers, psi, Omega = forward_moments(win, method, forward, cfg)
        if not tickers:
            continue
        caps = win.groupby('ticker')['market_cap'].last().to_dict()

        if book == 'mvo':
            w = book1_mvo(tickers, psi, Omega, caps, cfg)
        else:
            rc = _realized_cov(win, tickers, win_len) if cfg.corr_source == 'realized' else None
            w = book2_civp(tickers, Omega, cfg, realized_cov=rc)

        # ---- score: hold from rebal to next rebalance ----
        nxt = rebal_dates[i + 1]
        hold = test[(test['date'] > rebal) & (test['date'] <= nxt)]
        port = 0.0
        for t, wt in w.items():
            r = hold[hold['ticker'] == t]['stock_ret'].values
            if len(r):
                port += wt * ((1 + r).prod() - 1)
        spy = (1 + hold.drop_duplicates('date')['market_ret'].values).prod() - 1

        # equal-weight-of-held baseline
        held = [t for t in w if w[t] > 0]
        ew = 0.0
        if held:
            ewt = 1.0 / len(held)
            for t in held:
                r = hold[hold['ticker'] == t]['stock_ret'].values
                if len(r):
                    ew += ewt * ((1 + r).prod() - 1)

        names = set(w) | set(prev_w)
        turnover = sum(abs(w.get(t, 0.0) - prev_w.get(t, 0.0)) for t in names)
        spy_cost = cost if not rows else 0.0

        rows.append({'date': nxt, 'rebal_date': rebal,
                     'port_ret': port, 'port_ret_net': port - turnover * cost,
                     'spy_ret': spy, 'spy_ret_net': spy - spy_cost,
                     'ew_ret': ew, 'turnover': turnover,
                     'n_held': len(held), 'n_universe': len(tickers), 'stock_w': w})
        prev_w = w
        if verbose and (i % 25 == 0):
            tot = np.prod([1 + r['port_ret'] for r in rows]) - 1
            tsp = np.prod([1 + r['spy_ret'] for r in rows]) - 1
            print(f"  {pd.Timestamp(nxt).date()}  [{i+1}/{len(rebal_dates)-1}]  "
                  f"port={port:+.2%} spy={spy:+.2%} | held={len(held)}/{len(tickers)} "
                  f"| TOTAL port={tot:+.1%} spy={tsp:+.1%}")

    bt = pd.DataFrame(rows)
    if bt.empty:
        raise ValueError("No rebalances produced weights — universe too sparse / history too short.")

    # final one-off exit cost on the last week (consistent with your convention)
    for c in ['port_ret_net', 'spy_ret_net']:
        bt.loc[bt.index[-1], c] -= cost
    for k in ['port_ret', 'port_ret_net', 'spy_ret', 'spy_ret_net', 'ew_ret']:
        bt[k.replace('_ret', '_growth')] = (1 + bt[k]).cumprod()

    if verbose:
        _summary(bt, cfg, book, method)
    return bt


def _summary(bt, cfg, book, method):
    def stats(r):
        r = np.asarray(pd.Series(r).dropna(), float)
        if len(r) == 0:
            return dict(sharpe=np.nan, cagr=np.nan, vol=np.nan, maxdd=np.nan)
        eq = np.cumprod(1 + r)
        mdd = float((eq / np.maximum.accumulate(eq) - 1).min())
        return dict(sharpe=(r.mean() * cfg.ppy) / (r.std() * np.sqrt(cfg.ppy)) if r.std() > 0 else np.nan,
                    cagr=eq[-1] ** (cfg.ppy / len(r)) - 1, vol=r.std() * np.sqrt(cfg.ppy), maxdd=mdd)
    print(f"\n# GLOBAL-OMEGA BACKTEST  book={book}  method={method}  "
          f"objective={cfg.mvo_objective}  corr={cfg.corr_source}  mktvar={cfg.market_var_mode}")
    print(f"{'series':>10} {'Sharpe':>8} {'CAGR':>9} {'vol':>8} {'maxDD':>9}")
    for name, col in [('port(net)', 'port_ret_net'), ('port(grs)', 'port_ret'),
                      ('SPY', 'spy_ret'), ('EW', 'ew_ret')]:
        if col in bt:
            s = stats(bt[col])
            print(f"{name:>10} {s['sharpe']:>8.2f} {s['cagr']:>+9.1%} {s['vol']:>8.1%} {s['maxdd']:>+9.1%}")
    print(f"  weeks={len(bt)}  avg turnover/reb={bt['turnover'].mean():.2f}  "
          f"avg held={bt['n_held'].mean():.0f}/{bt['n_universe'].mean():.0f}")
