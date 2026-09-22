
import numpy as np
import pandas as pd

try:
    from scipy.cluster.hierarchy import linkage, fcluster
    from scipy.spatial.distance import squareform
    _HAVE_SCIPY = True
except Exception:                                    # graceful fallback
    _HAVE_SCIPY = False


# ----------------------------- core weighting ------------------------------
def _cov_to_vol_corr(cov):
    """Split a covariance matrix into per-asset vol and the correlation matrix."""
    cov = np.asarray(cov, float)
    d = np.diag(cov).copy()
    d[~np.isfinite(d)] = np.nan
    d[d <= 0] = np.nan                               # non-positive variance -> mark bad
    vol = np.sqrt(d)
    with np.errstate(invalid='ignore', divide='ignore'):
        corr = cov / np.outer(vol, vol)
    corr[~np.isfinite(corr)] = 0.0
    np.fill_diagonal(corr, 1.0)
    return vol, corr


def _clusters_from_corr(corr, max_clusters=None, corr_threshold=0.5):
   
    n = corr.shape[0]
    if n <= 2 or not _HAVE_SCIPY:
        # 1-2 names: each is its own cluster (nothing to merge meaningfully)
        return np.arange(n)

    dist = np.sqrt(np.clip(0.5 * (1.0 - corr), 0.0, 1.0))
    np.fill_diagonal(dist, 0.0)
    dist = 0.5 * (dist + dist.T)                      # force exact symmetry
    Z = linkage(squareform(dist, checks=False), method='average')

    cut = np.sqrt(0.5 * (1.0 - corr_threshold))       # distance matching the corr cut
    labels = fcluster(Z, t=cut, criterion='distance')
    if max_clusters is not None and labels.max() > max_clusters:
        labels = fcluster(Z, t=max_clusters, criterion='maxclust')
    return labels - 1                                 # 0-indexed


def cluster_ivp_weights(cov, corr_threshold=0.5, max_clusters=None,
                        return_labels=False):
    
    cov = np.asarray(cov, float)
    n = cov.shape[0]
    if n == 0:
        return (np.array([]), np.array([])) if return_labels else np.array([])
    if n == 1:
        w = np.array([1.0])
        return (w, np.array([0])) if return_labels else w

    vol, corr = _cov_to_vol_corr(cov)
    good = np.isfinite(vol) & (vol > 0)
    if good.sum() == 0:                               # no usable vol -> equal weight
        w = np.full(n, 1.0 / n)
        return (w, np.zeros(n, int)) if return_labels else w

    # impute bad vols with the median so clustering/sizing stays finite
    vfill = vol.copy()
    vfill[~good] = np.nanmedian(vol[good])

    labels = _clusters_from_corr(corr, max_clusters=max_clusters,
                                 corr_threshold=corr_threshold)

    w = np.zeros(n)
    cluster_var = {}
    within = {}
    for c in np.unique(labels):
        idx = np.where(labels == c)[0]
        iv = 1.0 / vfill[idx]
        iv = iv / iv.sum()                            # within-cluster inverse-vol
        within[c] = (idx, iv)
        Sig_c = cov[np.ix_(idx, idx)]
        vc = float(iv @ Sig_c @ iv)                  # cluster (super-asset) variance
        cluster_var[c] = vc if np.isfinite(vc) and vc > 0 else np.nan

    cvals = np.array([cluster_var[c] for c in np.unique(labels)], float)
    if np.all(~np.isfinite(cvals)):                   # fallback: equal across clusters
        across = {c: 1.0 / len(cvals) for c in np.unique(labels)}
    else:
        med = np.nanmedian(cvals[np.isfinite(cvals)])
        inv = {}
        for c in np.unique(labels):
            vc = cluster_var[c]
            inv[c] = 1.0 / np.sqrt(vc if (np.isfinite(vc) and vc > 0) else med)
        tot = sum(inv.values())
        across = {c: inv[c] / tot for c in inv}

    for c in np.unique(labels):
        idx, iv = within[c]
        w[idx] = across[c] * iv

    w = np.clip(w, 0, None)
    w = w / w.sum() if w.sum() > 0 else np.full(n, 1.0 / n)
    return (w, labels) if return_labels else w


# ---------------- covariance straight from a returns panel -----------------
def sample_cov(returns_df, min_obs=30, shrink=0.10):
    
    R = returns_df.dropna(axis=1, thresh=min_obs)
    C = R.cov().values
    if shrink and C.shape[0] > 1:
        mu = np.trace(C) / C.shape[0]
        C = (1 - shrink) * C + shrink * mu * np.eye(C.shape[0])
    return C, list(R.columns)


# --------------- drop-in book builder (replaces build_S_alpha_weights) ------
def build_cluster_ivp_weights(group_results, market_caps, sigma_bar_sq=None,
                              across='ivp', corr_threshold=0.5, max_clusters=None):
    
    group_names = list(group_results.keys())
    if not group_names:
        return {}, {}

    within_w, group_var, group_cap = {}, {}, {}
    for g in group_names:
        res = group_results[g]
        tks = list(res['tickers'])
        cov = np.asarray(res['Omega_full'], float)
        w = cluster_ivp_weights(cov, corr_threshold=corr_threshold,
                                max_clusters=max_clusters)
        within_w[g] = dict(zip(tks, w))
        group_var[g] = float(w @ cov @ w)             # subsector super-asset variance
        group_cap[g] = sum(float(market_caps.get(t, 0.0)) for t in tks)

    # ---- across-subsector allocation ----
    if across == 'ew':
        top = {g: 1.0 / len(group_names) for g in group_names}
    elif across == 'cap':
        tot = sum(group_cap.values()) or float(len(group_names))
        top = {g: (group_cap[g] / tot if tot else 1.0 / len(group_names)) for g in group_names}
    else:                                             # 'ivp' (default)
        vs = np.array([group_var[g] for g in group_names], float)
        med = np.nanmedian(vs[np.isfinite(vs) & (vs > 0)]) if np.any(np.isfinite(vs)) else 1.0
        inv = {g: 1.0 / np.sqrt(group_var[g] if (np.isfinite(group_var[g]) and group_var[g] > 0) else med)
               for g in group_names}
        tot = sum(inv.values())
        top = {g: inv[g] / tot for g in group_names}

    stock_weights, group_weights = {}, {}
    for g in group_names:
        group_weights[g] = top[g]
        for t, wi in within_w[g].items():
            stock_weights[t] = stock_weights.get(t, 0.0) + top[g] * wi

    s = sum(stock_weights.values())
    if s > 0:
        stock_weights = {t: w / s for t, w in stock_weights.items()}
    return stock_weights, group_weights


# ------------------- per-subsector: cluster IVP vs actual -------------------
def subsector_report(group_results, market_caps, hold, price_col='stock_ret',
                     corr_threshold=0.5, max_clusters=None, printer=print,
                     rebal_label=None):
    
    def _wret(weights):
        r = 0.0
        for t, wt in weights.items():
            v = hold[hold['ticker'] == t][price_col].values
            if len(v):
                r += wt * ((1 + v).prod() - 1)
        return r

    recs = []
    for g in group_results:
        res = group_results[g]
        tks = list(res['tickers'])
        cov = np.asarray(res['Omega_full'], float)
        w_ivp, labels = cluster_ivp_weights(cov, corr_threshold=corr_threshold,
                                            max_clusters=max_clusters, return_labels=True)
        civp_w = dict(zip(tks, w_ivp))

        caps = np.array([float(market_caps.get(t, 0.0)) for t in tks])
        cap_w = dict(zip(tks, caps / caps.sum())) if caps.sum() > 0 \
            else {t: 1.0 / len(tks) for t in tks}

        r_ivp = _wret(civp_w)
        r_act = _wret(cap_w)
        recs.append({'subsector': g, 'n': len(tks), 'k_clusters': int(np.unique(labels).size),
                     'cluster_ivp_ret': r_ivp, 'actual_capwt_ret': r_act,
                     'diff': r_ivp - r_act})

    df = pd.DataFrame(recs).sort_values('subsector').reset_index(drop=True)

    if printer is not None and len(df):
        hdr = f"  [subsector: cluster-IVP vs actual (cap-wt)]"
        if rebal_label is not None:
            hdr += f"  as of {pd.Timestamp(rebal_label).date()}"
        printer(hdr)
        printer(f"    {'subsector':<26} {'n':>3} {'k':>2} {'clusterIVP':>11} {'actual':>10} {'diff':>9}")
        for _, r in df.iterrows():
            printer(f"    {r['subsector']:<26} {int(r['n']):>3} {int(r['k_clusters']):>2} "
                    f"{r['cluster_ivp_ret']:>+11.2%} {r['actual_capwt_ret']:>+10.2%} {r['diff']:>+9.2%}")
        agg_ivp = df['cluster_ivp_ret'].mean()
        agg_act = df['actual_capwt_ret'].mean()
        printer(f"    {'-- equal-wt avg across subs':<26} {'':>3} {'':>2} "
                f"{agg_ivp:>+11.2%} {agg_act:>+10.2%} {agg_ivp-agg_act:>+9.2%}")
    return df



def backtest_cluster_ivp(data, split='2013-01-01', regimes=2, forward=1,
                         horizon='W', across='ivp', corr_threshold=0.5,
                         max_clusters=None, cost_bps=10, kill_pi=None,
                         print_subsectors=True, run_name='cluster_ivp'):
    
    from forward_beta import fit_regime_model, compute_forward_beta
    from portfolio_fb import compute_portfolio_weights, static_capweight, _perf_metrics, _infer_ann

    data = data.copy()
    data['date'] = pd.to_datetime(data['date'])
    split = pd.Timestamp(split)
    train = data[data['date'] < split]
    test = data[data['date'] >= split]

    rebal_dates = sorted(test['date'].unique())[::forward]
    base_ppy = {'D': 252, 'W': 52, 'ME': 12}.get(horizon, 52)
    ppy = base_ppy / forward
    sigma_bar_sq = (0.04 ** 2) / ppy                  # kept for signature parity only

    rows, sub_reports = [], []
    for i, rebal in enumerate(rebal_dates[:-1]):
        train_window = pd.concat([train, test[test['date'] < rebal]])
        all_thetas, group_hmms, group_map = fit_regime_model(train_window, regimes)
        if not group_hmms:
            continue
        all_fwd = compute_forward_beta(all_thetas, group_hmms, group_map,
                                       h=forward, kill_pi=kill_pi)
        gr = compute_portfolio_weights(all_fwd, all_thetas, group_hmms, group_map,
                                       train_window, h=forward, sigma_bar_sq=sigma_bar_sq)
        if not gr:
            continue
        caps = train_window.groupby('ticker')['market_cap'].last().to_dict()

        # ---- CLUSTER-IVP BOOK (risk + correlation only) ----
        stock_w, group_w = build_cluster_ivp_weights(
            gr, caps, sigma_bar_sq, across=across,
            corr_threshold=corr_threshold, max_clusters=max_clusters)

        nxt = rebal_dates[i + 1]
        hold = test[(test['date'] > rebal) & (test['date'] <= nxt)]

        # per-subsector cluster IVP vs actual (cap-weight)
        rep = subsector_report(gr, caps, hold, price_col='stock_ret',
                               corr_threshold=corr_threshold, max_clusters=max_clusters,
                               printer=(print if print_subsectors else None),
                               rebal_label=rebal)
        rep['rebal'] = rebal
        sub_reports.append(rep)

        def _score(weights):
            r = 0.0
            for t, wt in weights.items():
                v = hold[hold['ticker'] == t]['stock_ret'].values
                if len(v):
                    r += wt * ((1 + v).prod() - 1)
            return r

        civp = _score(stock_w)
        static_w = static_capweight(gr, caps)         # cap-weight everything (paper benchmark)
        stat = _score(static_w)
        spy = (1 + hold.drop_duplicates('date')['market_ret'].values).prod() - 1

        prev = rows[-1]['stock_w'] if rows else {}
        names = set(stock_w) | set(prev)
        turn = sum(abs(stock_w.get(t, 0) - prev.get(t, 0)) for t in names)
        cost = turn * cost_bps / 10000.0
        spy_cost = (cost_bps / 10000.0) if not rows else 0.0

        rows.append({'date': nxt, 'rebal_date': rebal,
                     'civp_ret': civp, 'civp_ret_net': civp - cost, 'turnover': turn,
                     'static_ret': stat, 'spy_ret': spy, 'spy_ret_net': spy - spy_cost,
                     'stock_w': stock_w, 'group_w': group_w})

        if print_subsectors:
            print(f"  => book: clusterIVP={civp:+.2%} (net {civp-cost:+.2%})  "
                  f"cap-wt={stat:+.2%}  spy={spy:+.2%}   turnover={turn:.2f}\n")

    bt = pd.DataFrame(rows)
    if not len(bt):
        print("[cluster_ivp] no rebalances produced — check universe / data length.")
        return bt, sub_reports

    _liq = cost_bps / 10000.0
    bt.loc[bt.index[-1], 'civp_ret_net'] -= _liq
    bt.loc[bt.index[-1], 'spy_ret_net'] -= _liq
    bt['civp_growth'] = (1 + bt['civp_ret']).cumprod()
    bt['civp_growth_net'] = (1 + bt['civp_ret_net']).cumprod()
    bt['static_growth'] = (1 + bt['static_ret']).cumprod()
    bt['spy_growth'] = (1 + bt['spy_ret']).cumprod()

    ann, _ = _infer_ann(bt['date'])
    print("\n" + "=" * 68)
    print(f"  CLUSTER-IVP BACKTEST  (across={across}, corr_thr={corr_threshold}, RRG OFF)")
    print("=" * 68)
    print(f"{'series':>16} {'Sharpe':>8} {'Sortino':>8} {'CAGR':>9} {'vol':>8} {'maxDD':>9}")
    for name, col in [('Cluster-IVP (net)', 'civp_ret_net'), ('Cap-weight', 'static_ret'),
                      ('SPY', 'spy_ret')]:
        m = _perf_metrics(bt[col], ann)
        print(f"{name:>16} {m['sharpe']:>8.2f} {m['sortino']:>8.2f} "
              f"{m['cagr']:>+9.1%} {m['vol']:>8.1%} {m['maxdd']:>+9.1%}")

    # aggregate subsector edge of cluster-IVP over cap-weight
    allrep = pd.concat(sub_reports, ignore_index=True)
    by_sub = (allrep.groupby('subsector')[['cluster_ivp_ret', 'actual_capwt_ret', 'diff']]
              .mean().sort_values('diff', ascending=False))
    print(f"\n  AVERAGE per-subsector edge (cluster-IVP minus cap-weight), best -> worst:")
    print(f"    {'subsector':<26} {'clusterIVP':>11} {'actual':>10} {'diff':>9}")
    for su, r in by_sub.iterrows():
        print(f"    {su:<26} {r['cluster_ivp_ret']:>+11.2%} "
              f"{r['actual_capwt_ret']:>+10.2%} {r['diff']:>+9.2%}")
    win = (by_sub['diff'] > 0).mean()
    print(f"    subsectors where cluster-IVP beat cap-weight on average: {win:.0%}")
    return bt, sub_reports
