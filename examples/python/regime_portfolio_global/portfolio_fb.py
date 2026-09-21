import numpy as np
import pandas as pd
from scipy.optimize import minimize
import matplotlib.pyplot as plt
from forward_beta import fit_regime_model, compute_forward_beta

# Notes on the code:
# - User can't use fewer than 2 stocks per ETF group
# - Market cap used for the backtest is the current snapshot, so there is a survivorship bias in the backtest
# - The regime model needs a large amount of data to identify regimes properly, so keep the training period through at least 2020

def _infer_ann(dates):
    """Periods per year inferred from the median spacing of the return dates."""
    d = pd.to_datetime(pd.Series(dates)).dropna().sort_values()
    if len(d) < 3:
        return 52.0, None
    md = d.diff().dt.days.median()
    if not md or md <= 0:
        return 52.0, None
    return 365.25 / md, float(md)


def _perf_metrics(rets, ann=52):
    r = np.asarray(pd.Series(rets).dropna(), float)
    if len(r) == 0:
        return {'sharpe': np.nan, 'sortino': np.nan, 'calmar': np.nan,
                'cagr': np.nan, 'vol': np.nan, 'maxdd': np.nan}
    mean_a = r.mean() * ann
    vol_a  = r.std() * np.sqrt(ann)
    dn     = r[r < 0]
    dd_dev = np.sqrt((dn ** 2).sum() / len(r)) * np.sqrt(ann) if len(dn) else 0.0   # downside deviation
    eq     = np.cumprod(1 + r)
    maxdd  = float((eq / np.maximum.accumulate(eq) - 1).min())
    cagr   = eq[-1] ** (ann / len(r)) - 1
    return {'sharpe':  mean_a / vol_a  if vol_a  > 0 else np.nan,
            'sortino': mean_a / dd_dev if dd_dev > 0 else np.nan,
            'calmar':  cagr / abs(maxdd) if maxdd < 0 else np.nan,
            'cagr': cagr, 'vol': vol_a, 'maxdd': maxdd}


def metrics(bt, ann=None, printer=print):
    """
    Full-sample risk-adjusted metrics per return series (net of cost where available):
      Sharpe  = annualized return / annualized vol
      Sortino = annualized return / annualized downside-deviation (only sub-zero weeks penalized)
      Calmar  = CAGR / |max drawdown|
    `ann` (periods/year) is INFERRED from the median spacing of bt['date'] unless you pass it,
    so the numbers are correct whether the book rebalances weekly, monthly, etc.
    Returns {name: {sharpe, sortino, calmar, cagr, vol, maxdd}}.
    """
    md = None
    if ann is None:
        ann, md = _infer_ann(bt['date']) if 'date' in bt.columns else (52.0, None)
    want = [('Port (HMM+RRG)', 'port_ret_net'), ('Pure HMM', 'hmm_ret_net'),
            ('EW', 'ew_ret_net'), ('SPY', 'spy_ret_net')]
    hdr = f"annualized x{ann:.1f}"
    if md is not None:
        hdr += f"  (inferred from dates: ~{md:.0f} days/period)"
    printer(f"\n# RISK-ADJUSTED (full sample, net of cost, {hdr})")
    printer(f"{'series':>16} {'Sharpe':>8} {'Sortino':>8} {'Calmar':>8} {'CAGR':>9} {'vol':>8} {'maxDD':>9}")
    out = {}
    for name, col in want:
        c = col if col in bt.columns else col.replace('_net', '')
        if c not in bt.columns:
            continue
        m = _perf_metrics(bt[c], ann); out[name] = m
        printer(f"{name:>16} {m['sharpe']:>8.2f} {m['sortino']:>8.2f} {m['calmar']:>8.2f} "
                f"{m['cagr']:>+9.1%} {m['vol']:>8.1%} {m['maxdd']:>+9.1%}")
    return out


def plot_growth(bt, save_path=None):

    # 4 stacked panels: cumulative growth, drawdown, and TWO year-by-year bar charts —
    # one GROSS (no cost) and one NET (cost applied to every strategy). Both YoY charts show
    # exactly three series: SPY, Port (HMM+RRG), Pure HMM.
    fig, (ax1, ax2, ax3, ax4) = plt.subplots(4, 1, figsize=(12, 18),
                                             height_ratios=[2, 1, 1.4, 1.4])

    # --- top: cumulative growth, all series ---
    ax1.plot(bt['date'], bt['port_growth'],     label='Port HMM+RRG (gross)', linewidth=2)
    ax1.plot(bt['date'], bt['port_growth_net'], label='Port HMM+RRG (net of cost)', linewidth=1.5, linestyle=':')
    ax1.plot(bt['date'], bt['spy_growth'],      label='SPY', linewidth=1.2, linestyle='--')
    if 'hmm_growth' in bt:
        ax1.plot(bt['date'], bt['hmm_growth'],  label='Pure HMM (RRG off)', linewidth=1.4, alpha=0.9)
    if 'ew_growth' in bt:
        ax1.plot(bt['date'], bt['ew_growth'],   label='EW (subsector-EW, cap within)', linewidth=1.2, linestyle='-.')
    ax1.set_title('Cumulative Growth of $1'); ax1.set_ylabel('Growth of $1')
    ax1.legend(); ax1.grid(alpha=0.3)

    # --- drawdown of the regime portfolio vs SPY ---
    def drawdown(g):
        return g / g.cummax() - 1
    ax2.fill_between(bt['date'], drawdown(bt['port_growth']), 0, alpha=0.4, label='Port drawdown')
    ax2.plot(bt['date'], drawdown(bt['spy_growth']), linewidth=1, linestyle='--', label='SPY drawdown')
    ax2.set_title('Drawdown'); ax2.set_ylabel('Drawdown'); ax2.set_xlabel('Date')
    ax2.legend(); ax2.grid(alpha=0.3)

    yb = bt.set_index('date')
    def yoy(col):
        return (1 + yb[col]).groupby(yb.index.year).prod() - 1

    # --- YoY GROSS (no cost): SPY / Port (HMM+RRG) / Pure HMM ---
    yr_g = pd.DataFrame({
        'SPY':            yoy('spy_ret'),
        'Port (HMM+RRG)': yoy('port_ret'),
        'Pure HMM':       yoy('hmm_ret'),
    })
    yr_g.plot(kind='bar', ax=ax3, width=0.82)
    ax3.set_title('Year-by-year return — GROSS (no cost)')
    ax3.set_ylabel('Return'); ax3.set_xlabel('Year')
    ax3.axhline(0, color='k', linewidth=0.6); ax3.grid(alpha=0.3, axis='y'); ax3.legend(fontsize=8)
    ax3.set_xticklabels([str(int(y)) for y in yr_g.index], rotation=0)

    # --- YoY NET (cost applied to ALL): SPY / Port (HMM+RRG) / Pure HMM ---
    #     SPY is costed at entry + exit; Port & Pure HMM carry per-rebalance turnover cost
    #     plus a final liquidation (see portfolio_backtest for how the *_ret_net are built).
    net_spy = 'spy_ret_net' if 'spy_ret_net' in yb else 'spy_ret'
    net_hmm = 'hmm_ret_net' if 'hmm_ret_net' in yb else 'hmm_ret'
    yr_n = pd.DataFrame({
        'SPY (net)':            yoy(net_spy),
        'Port (HMM+RRG, net)':  yoy('port_ret_net'),
        'Pure HMM (net)':       yoy(net_hmm),
    })
    yr_n.plot(kind='bar', ax=ax4, width=0.82)
    ax4.set_title('Year-by-year return — NET of cost')
    ax4.set_ylabel('Return'); ax4.set_xlabel('Year')
    ax4.axhline(0, color='k', linewidth=0.6); ax4.grid(alpha=0.3, axis='y'); ax4.legend(fontsize=8)
    ax4.set_xticklabels([str(int(y)) for y in yr_n.index], rotation=0)

    plt.tight_layout()
    if save_path:
        fig.savefig(save_path, dpi=150, bbox_inches='tight')
        print(f"[saved] {save_path}")
    plt.show()

def plot_pi_comparison(bt_on, bt_off):
    """Test 2: does the transition matrix matter? Overlays real-Pi vs neutered-Pi growth."""
    
    plt.figure(figsize=(11, 5))
    plt.plot(bt_on['date'],  bt_on['port_growth'],  label='Π ON (real dynamics)', linewidth=2)
    plt.plot(bt_off['date'], bt_off['port_growth'], label='Π OFF (identity)', linewidth=1.5, linestyle='--')
    plt.title('Does the transition matrix matter?')
    plt.xlabel('Date'); plt.ylabel('Growth of $1')
    plt.legend(); plt.grid(alpha=0.3)
    plt.tight_layout(); plt.show()

def _run_diagnostics(bt, macro=None, thresh=-0.02):
    """Post-backtest research diagnostics (opt-in). Reads only the finished bt (+ macro). No rerun."""
    print("\n" + "=" * 60 + "\n  DIAGNOSTICS\n" + "=" * 60)

    # #2 ORACLE ceiling -- analytic (weight×expo => return×expo; exact for forward=1)
    if 'spy_ret' in bt and 'port_growth' in bt:
        expo  = np.where(bt['spy_ret'].values < thresh, 0.0, 1.0)     # cheat: skip weeks the market falls
        orc_g = pd.Series((1 + bt['port_ret'].values * expo).cumprod(), index=bt.index)
        print(f"\n[#2 oracle ceiling, thresh={thresh:.0%}]")
        for name, g in [('base', bt['port_growth']), ('oracle', orc_g)]:
            print(f"  {name:7s} final ${g.iloc[-1]:.3f}   maxDD {(g/g.cummax()-1).min():.1%}")
        print(f"  oracle sat out {int((expo==0).sum())} of {len(expo)} weeks")

    # #3 gamma(bear) vs SPY drawdown lead-lag
    if 'group_regime' in bt:
        d = bt.sort_values('date').reset_index(drop=True)
        d['gbear'] = d['group_regime'].apply(lambda gr: float(np.mean([g['gamma'][0] for g in gr.values()])))
        d['spy_g'] = (1 + d['spy_ret']).cumprod(); d['spy_dd'] = d['spy_g'] / d['spy_g'].cummax() - 1
        cc = {k: d['gbear'].corr(d['spy_ret'].shift(-k)) for k in range(-4, 5)}
        kbest = min(cc, key=lambda k: cc[k])
        verdict = ('gamma REACTS to past drops (lagging)' if kbest < 0
                   else 'gamma coincident' if kbest == 0 else 'gamma LEADS')
        fig, ax = plt.subplots(figsize=(12, 4))
        ax.plot(d['date'], d['gbear'], color='crimson', lw=2); ax.set_ylim(0, 1)
        ax.set_ylabel('P(bear)', color='crimson')
        ax2 = ax.twinx(); ax2.fill_between(d['date'], d['spy_dd'], 0, color='steelblue', alpha=.3)
        ax2.set_ylabel('SPY drawdown', color='steelblue')
        ax.set_title(f'#3  gamma(bear) vs SPY drawdown -- neg corr at lag {kbest:+d} wk -> {verdict}')
        plt.tight_layout(); plt.show()
        print(f"\n[#3 lead-lag] {verdict}   corr by lag:", {k: round(v, 2) for k, v in cc.items()})

    # #4 macro lead table
    if macro is not None and 'rebal_date' in bt:
        vw = macro['vix_spot'].resample('W-SUN').last(); cw = macro['credit'].resample('W-SUN').last()
        sig = pd.DataFrame({'VIX': vw, 'dVIX': vw.diff(), 'credit': cw, 'dcredit': cw.diff()})
        def asof(s, t):
            ss = s[s.index <= pd.Timestamp(t)]; return ss.iloc[-1] if len(ss) else np.nan
        recs = []
        for _, r in bt.iterrows():
            row = {k: asof(sig[k], r['rebal_date']) for k in sig.columns}
            row['port'] = r['port_ret']; row['spy'] = r['spy_ret']; recs.append(row)
        X = pd.DataFrame(recs).dropna()
        tbl = pd.DataFrame({'corr vs next-wk PORT': [X[k].corr(X['port']) for k in sig.columns],
                            'corr vs next-wk SPY':  [X[k].corr(X['spy'])  for k in sig.columns]}, index=sig.columns)
        print("\n[#4 macro lead table]\n", tbl.round(3))
    elif macro is None:
        print("\n[#4] skipped -- no macro passed")

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

        std_g  = scaler_g.scale_
        mean_g = scaler_g.mean_
        mu_states    = np.array([hmm_g.means_[s] * std_g + mean_g for s in order_g])
        Sigma_states = np.array([np.diag(std_g) @ hmm_g.covars_[s] @ np.diag(std_g)
                                 for s in order_g])                                          # m x 3 x 3

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
        

        psi_t = Phi_h.T @ mu_t                                   # (n,3) * (3,) = (n,)

        group_results[group_name] = {
            'tickers'     : group_tickers,
            'psi'         : psi_t,
            'Omega_full': Omega_full,        # within-group, no market (stays block-diagonal)
            'beta_mkt'    : beta_mkt,            # for the universe-wide market term
            'sigma2_mkt'  : sigma2_mkt,         # this group's market variance (largest group wins)
            'n_group'     : n,                  # size, to pick the largest group
        }
    return group_results


def build_S_alpha_weights(group_results, market_caps, sigma_bar_sq):
    group_names = list(group_results.keys())
    tickers, groups, psi_parts, full_blocks = [], [], [], []
    for g in group_names:
        res = group_results[g]
        tickers    += list(res['tickers'])
        groups     += [g] * len(res['tickers'])
        psi_parts  .append(np.asarray(res['psi']).ravel())
        full_blocks.append(np.asarray(res['Omega_full']))     # full group risk, kept whole

    n, q = len(tickers), len(group_names)
    psi   = np.concatenate(psi_parts)                          

    # Level-2 Omega: block-diagonal non-market  +  full universe-wide market term
    Omega = _block_diag(full_blocks)                        # (n,n) within-group, no market
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


def portfolio_backtest(train, test, regimes, forward, horizon='W', kill_pi=None,
                       macro=None, run_name='dynamic', live_dashboard=False, factors=None,
                       rrg_verbose=False, stock_dmin=2.0):
    rebal_dates = sorted(test['date'].unique())[::forward]
    base_ppy = {'D': 252, 'W': 52, 'ME': 12}.get(horizon, 52)   
    ppy = base_ppy / forward
    sigma_bar_sq = (0.04 ** 2) / ppy      # fixed tracking-error budget
    COST_BPS = 10                          # per-unit-turnover transaction cost (round trip charged as it turns over)

    # --- STOCK-LEVEL RRG: precompute per-stock rs_ratio/rs_mom/dist once (causal, read as-of) ---
    srr = srm = sdist = None
    if factors is not None:
        from rrg import compute_stock_rrg
        full = pd.concat([train, test])
        spy_w = full.drop_duplicates('date').set_index('date')['market_ret'].sort_index()
        srr, srm, sdist = compute_stock_rrg(full, spy_w)

    import os, datetime
    os.makedirs('logs', exist_ok=True)
    stamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    log_path = f'logs/{run_name}_{stamp}.log'
    logf = open(log_path, 'w')
    def log(msg):
        print(msg)
        logf.write(str(msg) + '\n')
        logf.flush()
    log(f"# run={run_name} regimes={regimes} forward={forward} horizon={horizon} "
        f"kill_pi={kill_pi} sigma_bar_sq={sigma_bar_sq:.6g}")

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

        group2sub = None
        if factors is not None:
            from rrg import group_subsector_map
            group2sub = group_subsector_map(train_window, group_results)

        # pure HMM shadow (full universe, RRG off) — always scored for side-by-side comparison
        stock_w_hmm, _ = build_S_alpha_weights(group_results, caps, sigma_bar_sq)

        # --- STOCK-LEVEL RRG: keep Improving & dist>2 stocks, CAP-WEIGHT them; else CASH ---
        #     n_by_sub = how many stocks we actually invested in, per subsector.
        n_by_sub = {}
        rrg_legA = rrg_legB = None
        if factors is not None:
            from rrg import stock_improving_asof
            qual = stock_improving_asof(srr, srm, sdist, rebal, dmin=stock_dmin)
            picks = []
            for g in group_results:
                gts = [t for t in group_results[g]['tickers'] if t in qual]
                n_by_sub[(group2sub.get(g) or g).replace('FFX_', '')] = len(gts)
                picks += gts
            if picks:                                            # cap-weight the qualifying stocks
                capsum = sum(caps.get(t, 0.0) for t in picks) or float(len(picks))
                stock_w = {t: (caps.get(t, 0.0) / capsum if capsum else 1.0 / len(picks)) for t in picks}
            else:
                stock_w = {}                                     # nothing qualifies -> all cash
            group_a = {}
            rrg_legA = sorted(qual)                               # store the picked tickers
        else:
            stock_w, group_a = build_S_alpha_weights(group_results, caps, sigma_bar_sq)  # pure HMM

        for g in group_results:                                  # pad excluded names to 0
            group_a.setdefault(g, 0.0)
            for t in group_results[g]['tickers']:
                stock_w.setdefault(t, 0.0)

        if factors is not None and rrg_verbose:
            n_inv = sum(1 for w in stock_w.values() if w > 0)
            counts = {k: v for k, v in sorted(n_by_sub.items(), key=lambda kv: -kv[1]) if v}
            mode = f'{n_inv} stocks (cap-weight)' if n_inv else 'ALL CASH (no Improving stock)'
            print(f"\n[RRG rebal {pd.Timestamp(rebal).date()}]  {mode}   stocks/subsector: {counts if counts else 'none'}")

        # ---- score: hold weights from rebal to next rebalance, vs SPY ----
        nxt  = rebal_dates[i + 1]
        hold = test[(test['date'] > rebal) & (test['date'] <= nxt)]

        port = 0.0
        for t, wt in stock_w.items():
            r = hold[hold['ticker'] == t]['stock_ret'].values
            if len(r):
                port += wt * ((1 + r).prod() - 1)               # compounded stock return over window
        spy = (1 + hold.drop_duplicates('date')['market_ret'].values).prod() - 1

        # pure-HMM shadow return (full universe, RRG off) for side-by-side comparison
        port_hmm = 0.0
        for t, wt in stock_w_hmm.items():
            r = hold[hold['ticker'] == t]['stock_ret'].values
            if len(r):
                port_hmm += wt * ((1 + r).prod() - 1)

        # regimes-OFF cap-weight (Test 1)
        static_w = static_capweight(group_results, caps)
        stat = 0.0
        for t, wt in static_w.items():
            r = hold[hold['ticker'] == t]['stock_ret'].values
            if len(r):
                stat += wt * ((1 + r).prod() - 1)

        # EQUAL-WEIGHT benchmark — "is the HMM weighting earning its keep?"
        # Hold the SAME stocks the port book holds (the RRG-selected improving/dist>2 names when
        # RRG is on; the optimizer's names when off), but weight them NAIVELY instead of via the
        # HMM -> forward-beta/return -> portfolio-optimization pipeline that sizes the port book:
        #     equal weight PER SUBSECTOR, market-cap weight WITHIN each subsector.
        # Same picks, dumb weights vs smart weights -> any gap is what the HMM weighting adds.
        sub_lookup = train_window.drop_duplicates('ticker').set_index('ticker')['subsector'].to_dict()
        sel = [t for t in stock_w if stock_w[t] > 0]             # exactly the names the port holds
        by_sub = {}
        for t in sel:
            by_sub.setdefault(sub_lookup.get(t), []).append(t)   # group the picks by subsector
        ew_weights = {}
        if by_sub:
            _per_sub = 1.0 / len(by_sub)                          # equal weight across held subsectors
            for su, ts in by_sub.items():
                scap = sum(caps.get(t, 0.0) for t in ts)
                for t in ts:                                     # cap-weight within the subsector
                    w_in = (caps.get(t, 0.0) / scap) if scap > 0 else (1.0 / len(ts))
                    ew_weights[t] = _per_sub * w_in
        ew = 0.0                                                  # picks empty (e.g. all-cash port) -> ew is cash too
        for t, wt in ew_weights.items():
            r = hold[hold['ticker'] == t]['stock_ret'].values
            if len(r):
                ew += wt * ((1 + r).prod() - 1)

        # turnover cost on the regime (port) book (Test 3b)
        prev_w = rows[-1]['stock_w'] if rows else {}
        names  = set(stock_w) | set(prev_w)
        turnover = sum(abs(stock_w.get(t, 0) - prev_w.get(t, 0)) for t in names)
        cost = turnover * COST_BPS / 10000

        # turnover cost on the pure-HMM shadow book (so it gets a fair net-of-cost series too)
        prev_hmm     = rows[-1]['stock_w_hmm'] if rows else {}
        hmm_names    = set(stock_w_hmm) | set(prev_hmm)
        hmm_turnover = sum(abs(stock_w_hmm.get(t, 0) - prev_hmm.get(t, 0)) for t in hmm_names)
        hmm_cost     = hmm_turnover * COST_BPS / 10000

        # turnover cost on the EW book (same picks, equal-per-subsector / cap-within weights)
        prev_ew     = rows[-1]['ew_weights'] if rows else {}
        ew_names    = set(ew_weights) | set(prev_ew)
        ew_turnover = sum(abs(ew_weights.get(t, 0) - prev_ew.get(t, 0)) for t in ew_names)
        ew_cost     = ew_turnover * COST_BPS / 10000

        # SPY is buy-and-hold: cost only on entry (first scored week; exit charged once post-loop).
        spy_cost    = (COST_BPS / 10000.0) if not rows else 0.0
        
        psi_by_stock = {t: p for g in group_results for t, p in zip(group_results[g]['tickers'], np.asarray(group_results[g]['psi']).ravel())}
        pred_port_ret = sum(stock_w.get(t, 0.0) * psi_by_stock.get(t, 0.0) for t in stock_w)
        act_by_stock = {t: ((1 + hold[hold['ticker'] == t]['stock_ret'].values).prod() - 1) if len(hold[hold['ticker'] == t]) else 0.0 for t in stock_w}
        gw_in = {t: stock_w[t] / max(sum(stock_w[u] for u in group_results[g]['tickers']), 1e-12) for g in group_results for t in group_results[g]['tickers']}
        group_perf = {g: {'weight': sum(stock_w[t] for t in group_results[g]['tickers']), 'pred': sum(gw_in[t]*psi_by_stock[t] for t in group_results[g]['tickers']), 'act': sum(gw_in[t]*act_by_stock[t] for t in group_results[g]['tickers'])} for g in group_results}
        vix_in, credit_in = (float(macro.loc[:rebal, 'vix_spot'].iloc[-1]), float(macro.loc[:rebal, 'credit'].iloc[-1])) if (macro is not None and len(macro.loc[:rebal])) else (np.nan, np.nan)
        group_regime = {g: {'gamma': group_hmms[g]['G'][-1].round(4).tolist(), 'hard': int(group_hmms[g]['G'][-1].argmax())} for g in group_results}


        rows.append({'date': nxt, 'rebal_date': rebal, 'port_ret': port, 'port_ret_net': port - cost,
                     'static_ret': stat, 'ew_ret': ew, 'ew_ret_net': ew - ew_cost, 'ew_turnover': ew_turnover,
                     'ew_weights': ew_weights, 'spy_ret': spy, 'spy_ret_net': spy - spy_cost,
                     'hmm_ret': port_hmm, 'hmm_ret_net': port_hmm - hmm_cost, 'hmm_turnover': hmm_turnover,
                     'stock_w_hmm': stock_w_hmm,
                     'turnover': turnover, 'rrg_legA': rrg_legA, 'rrg_legB': rrg_legB, 'n_by_sub': n_by_sub,
                     'stock_w': stock_w, 'group_w': group_a, 'pred_port_ret': pred_port_ret, 'group_perf': group_perf, 'vix_in': vix_in, 'credit_in': credit_in, 'group_regime': group_regime, 'psi_by_stock': psi_by_stock, 'act_by_stock': act_by_stock, 'ticker_group': {t: g for g in group_results for t in group_results[g]['tickers']}})
        if live_dashboard:
            import dashboards, importlib; importlib.reload(dashboards)
            dashboards.render_week(pd.DataFrame(rows), at=-1)
        cum = lambda k: np.prod([1 + r[k] for r in rows]) - 1     # totals so far (incl. this week)
        log(f"{nxt.date()} | "
            f"port={port:+.3%} (net {port-cost:+.3%})  "
            f"spy={spy:+.3%} (net {spy-spy_cost:+.3%})  "
            f"ew={ew:+.3%} (net {ew-ew_cost:+.3%})  "
            f"hmm={port_hmm:+.3%} (net {port_hmm-hmm_cost:+.3%})  ||  "
            f"TOTAL port={cum('port_ret'):+.2%} (net {cum('port_ret_net'):+.2%})  "
            f"spy={cum('spy_ret'):+.2%} (net {cum('spy_ret_net'):+.2%})  "
            f"ew={cum('ew_ret'):+.2%} (net {cum('ew_ret_net'):+.2%})  "
            f"hmm={cum('hmm_ret'):+.2%} (net {cum('hmm_ret_net'):+.2%})")

    bt = pd.DataFrame(rows)

    # ---- final liquidation: charge each strategy a one-off exit cost on the LAST week ----
    # Entry + ongoing turnover already sit inside each *_ret_net built in the loop (SPY: constant
    # 1.0 weight -> entry charged on the first scored week). Adding the exit here means every
    # strategy is costed at the START and the END, consistently.
    _liq = COST_BPS / 10000.0
    for _c in ['port_ret_net', 'spy_ret_net', 'ew_ret_net', 'hmm_ret_net']:
        bt.loc[bt.index[-1], _c] -= _liq

    bt['port_growth']     = (1 + bt['port_ret']).cumprod()       # growth of $1 (gross)
    bt['port_growth_net'] = (1 + bt['port_ret_net']).cumprod()   # after transaction cost
    bt['spy_growth']      = (1 + bt['spy_ret']).cumprod()
    bt['spy_growth_net']  = (1 + bt['spy_ret_net']).cumprod()    # SPY net (entry + exit cost)
    bt['static_growth']   = (1 + bt['static_ret']).cumprod()     # regimes-OFF cap-weight
    bt['ew_growth']       = (1 + bt['ew_ret']).cumprod()         # equal-weight subsectors, cap within (gross)
    bt['ew_growth_net']   = (1 + bt['ew_ret_net']).cumprod()     # EW net of cost
    bt['hmm_growth']      = (1 + bt['hmm_ret']).cumprod()         # pure HMM (RRG off) shadow (gross)
    bt['hmm_growth_net']  = (1 + bt['hmm_ret_net']).cumprod()    # pure HMM net of cost

    # ---- year-by-year returns (compounded within each calendar year) ----
    _yb = bt.set_index('date')
    yr_tbl = pd.DataFrame({
        'port_net': (1 + _yb['port_ret_net']).groupby(_yb.index.year).prod() - 1,
        'spy':      (1 + _yb['spy_ret']).groupby(_yb.index.year).prod() - 1,
        'ew':       (1 + _yb['ew_ret']).groupby(_yb.index.year).prod() - 1,
        'hmm':      (1 + _yb['hmm_ret']).groupby(_yb.index.year).prod() - 1,
    })
    log("\n# YEAR-BY-YEAR  (compounded; port net of cost; ew = subsector-EW/cap-within; hmm = pure HMM)")
    log(f"{'year':>6} {'port_net':>10} {'spy':>10} {'ew':>10} {'hmm':>10} {'port-hmm':>9} {'port-spy':>9}")
    for y, r in yr_tbl.iterrows():
        log(f"{int(y):>6} {r['port_net']:>+10.2%} {r['spy']:>+10.2%} {r['ew']:>+10.2%} {r['hmm']:>+10.2%} "
            f"{r['port_net']-r['hmm']:>+9.2%} {r['port_net']-r['spy']:>+9.2%}")

    _inf_ann, _md = _infer_ann(bt['date'])
    log(f"\n# annualization: ppy(config)={ppy:g}  |  inferred-from-dates={_inf_ann:.1f} "
        f"(~{_md:.0f} days/period)" + ("" if abs(_inf_ann - ppy) < 1 else "   <-- MISMATCH: using inferred"))
    metrics(bt, printer=log)   # ann inferred from dates (ground truth)

    # ---- persist ----
    bt.to_parquet(f'logs/{run_name}_{stamp}_bt.parquet')
    final = {'run': run_name, 'weeks': len(bt),
             'port_net':  float(bt['port_growth_net'].iloc[-1]),
             'port_gross':float(bt['port_growth'].iloc[-1]),
             'spy':       float(bt['spy_growth'].iloc[-1]),
             'static':    float(bt['static_growth'].iloc[-1]),
             'ew':        float(bt['ew_growth'].iloc[-1])}
    log(f"# FINAL {final}")
    logf.close()
    print(f"[saved] {log_path}  and  {run_name}_{stamp}_bt.parquet")
    return bt

def backtest_result_HMM(data, split='2020-01-01', regimes=2, forward=1, horizon='W',
                        kill_pi=None, macro=None, run_name='dynamic',
                        live_dashboard=False, diagnostics=False, factors=None,
                        rrg_verbose=False):
    data = data.copy()
    data['date'] = pd.to_datetime(data['date'])
    split = pd.Timestamp(split)
    train = data[data['date'] <  split]
    test  = data[data['date'] >= split]
    bt = portfolio_backtest(train, test, regimes, forward, horizon=horizon, kill_pi=kill_pi,
                            macro=macro, run_name=run_name,
                            live_dashboard=live_dashboard, factors=factors,
                            rrg_verbose=rrg_verbose)
    import datetime, os
    os.makedirs('logs', exist_ok=True)
    stamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    plot_growth(bt, save_path=f'logs/{run_name}_{stamp}_growth.png')
    if diagnostics:
        _run_diagnostics(bt, macro)
    return bt


def psi_shrinkage_sweep(data, split='2013-01-01', regimes=2, forward=1, horizon='W',
                        lambdas=(0.0, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0),
                        kill_pi=None, cost_bps=10, plot=True):
    """
    Sweep a shrinkage factor lambda on the HMM expected returns:  psi_used = lambda * psi.
    No RRG overlay — this isolates 'how much should I trust the forecast'. lambda=1 is Pure HMM.
    The HMM fit / forward-beta / psi are computed ONCE per rebalance and cached; only the
    optimizer + scoring re-run per lambda, so the whole sweep costs ~one backtest.

    Returns {lambda: {sharpe, cagr, maxdd, total, rets}} (net of turnover cost) and prints a
    table + optional Sharpe/CAGR/maxDD-vs-lambda plot. Benchmark yourself against lambda=1.
    """
    data = data.copy(); data['date'] = pd.to_datetime(data['date'])
    split = pd.Timestamp(split)
    train0 = data[data['date'] <  split]
    test   = data[data['date'] >= split]
    rebal_dates = sorted(test['date'].unique())[::forward]
    base_ppy = {'D': 252, 'W': 52, 'ME': 12}.get(horizon, 52)
    ppy = base_ppy / forward
    sigma_bar_sq = (0.04 ** 2) / ppy
    ann = ppy

    # ---- 1) run the expensive part ONCE, cache per-rebalance ingredients ----
    cache = []
    for i, rebal in enumerate(rebal_dates[:-1]):
        train_window = pd.concat([train0, test[test['date'] < rebal]])
        all_thetas, group_hmms, group_map = fit_regime_model(train_window, regimes)
        if not group_hmms:
            continue
        all_fwd = compute_forward_beta(all_thetas, group_hmms, group_map, h=forward, kill_pi=kill_pi)
        gr = compute_portfolio_weights(all_fwd, all_thetas, group_hmms, group_map,
                                       train_window, h=forward, sigma_bar_sq=sigma_bar_sq)
        if not gr:
            continue
        caps = train_window.groupby('ticker')['market_cap'].last().to_dict()
        nxt  = rebal_dates[i + 1]
        hold = test[(test['date'] > rebal) & (test['date'] <= nxt)]
        tret = {t: ((1 + hold[hold['ticker'] == t]['stock_ret'].values).prod() - 1)
                for g in gr for t in gr[g]['tickers'] if len(hold[hold['ticker'] == t])}
        cache.append({'gr': gr, 'caps': caps, 'tret': tret})
        if (i % 50) == 0:
            print(f"  cached {i}/{len(rebal_dates) - 1} rebalances")
    print(f"  cached {len(cache)} rebalances total\n")

    # ---- 2) for each lambda, re-optimize with psi_used = lambda*psi, score net of cost ----
    results = {}
    for lam in lambdas:
        rets, prev_w = [], {}
        for c in cache:
            gr_l = {g: {**c['gr'][g], 'psi': lam * np.asarray(c['gr'][g]['psi']).ravel()}
                    for g in c['gr']}
            sw, _ = build_S_alpha_weights(gr_l, c['caps'], sigma_bar_sq)
            port = sum(w * c['tret'].get(t, 0.0) for t, w in sw.items())
            names = set(sw) | set(prev_w)
            turn = sum(abs(sw.get(t, 0) - prev_w.get(t, 0)) for t in names)
            rets.append(port - turn * cost_bps / 10000.0)
            prev_w = sw
        r = np.asarray(rets)
        eq = np.cumprod(1 + r)
        results[lam] = {
            'sharpe': (r.mean() * ann) / (r.std() * np.sqrt(ann)) if r.std() > 0 else np.nan,
            'cagr':   eq[-1] ** (ann / len(r)) - 1,
            'maxdd':  float((eq / np.maximum.accumulate(eq) - 1).min()),
            'total':  eq[-1] - 1, 'rets': r,
        }

    print(f"{'lambda':>7} {'netSharpe':>10} {'CAGR':>9} {'maxDD':>9} {'total':>10}")
    for lam in lambdas:
        x = results[lam]
        star = '  <- Pure HMM' if abs(lam - 1.0) < 1e-9 else ''
        print(f"{lam:>7.2f} {x['sharpe']:>10.2f} {x['cagr']:>+9.1%} {x['maxdd']:>+9.1%} {x['total']:>+10.1%}{star}")
    best = max(results, key=lambda L: results[L]['sharpe'])
    print(f"\n  best net Sharpe at lambda={best:.2f} (Sharpe {results[best]['sharpe']:.2f}); "
          f"Pure HMM lambda=1 Sharpe {results[1.0]['sharpe']:.2f}" if 1.0 in results else "")

    if plot:
        import matplotlib.pyplot as plt
        L = list(lambdas)
        fig, ax = plt.subplots(1, 3, figsize=(16, 4.2))
        ax[0].plot(L, [results[l]['sharpe'] for l in L], 'o-'); ax[0].set_title('Net Sharpe vs lambda')
        ax[1].plot(L, [results[l]['cagr'] for l in L], 'o-', color='green'); ax[1].set_title('CAGR vs lambda')
        ax[2].plot(L, [results[l]['maxdd'] for l in L], 'o-', color='red'); ax[2].set_title('max Drawdown vs lambda')
        for a in ax:
            a.axvline(1.0, color='k', ls='--', lw=0.8, alpha=0.6); a.set_xlabel('lambda (psi shrink)'); a.grid(alpha=0.3)
        plt.tight_layout(); plt.show()
    return results
