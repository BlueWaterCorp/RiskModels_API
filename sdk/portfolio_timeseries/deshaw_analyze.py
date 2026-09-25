"""Task 6 — D.E.Shaw pipeline: Stage 0 gate, Stage 1 lagged gross, Stage 2 layers, CAPM,
loading drift. Restricted to the fetched recent window + top-weight names (partial coverage,
reported). Stage 0 gates everything: if the rebuild can't reproduce the endpoint, STOP.
Reuses build_lagged low-level helpers (does NOT touch Berkshire)."""
import riskmodels
import sys, json, warnings
from pathlib import Path
warnings.filterwarnings("ignore")
_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
import numpy as np, pandas as pd, build_lagged as B
B.CACHE_ONLY = True   # never fetch uncached names during analysis (partial universe)

NAME = "DEShaw"
import glob
metaf = B._CACHE / "deshaw_fetch_meta.json"
allteos = [r["teo"] for r in B.portfolio_rows(NAME)]
if metaf.exists():
    recent = json.load(open(metaf))["recent_teos"]
else:
    recent = allteos[-20:]  # meta not written (fetch incomplete) — derive the window ourselves
ncached = len(glob.glob(str(B._CACHE / "decomp_*.json")))
print(f"=== D.E.Shaw analysis: window {recent[0]}..{recent[-1]} ({len(recent)}q), "
      f"{ncached} decomp series cached (Berkshire+DEShaw) ===")

rows = {r["teo"]: r for r in B.portfolio_rows(NAME)}
teos = [t for t in recent if t in rows]

def sharpe(x):
    x = np.asarray([v for v in x if v is not None and not (isinstance(v,float) and np.isnan(v))])
    if len(x) < 3: return float("nan"), len(x)
    return (x.mean()/x.std(ddof=1))*np.sqrt(4), len(x)

def stats(x):
    x = np.asarray([v for v in x if v is not None and not np.isnan(v)])
    m, sd = x.mean(), x.std(ddof=1)
    return dict(n=len(x), mean_bps=m*1e4, t=m/(sd/np.sqrt(len(x))), hit=(x>0).mean()*100,
               sharpe=(m/sd)*np.sqrt(4), ann=(np.exp((4/len(x))*np.sum(np.log(1+x)))-1)*100)

# ---------- STAGE 0: gate ----------
print("\n--- STAGE 0: rebuild unlagged gross vs endpoint (covered-name renormalised) ---")
diffs = []; covs = []; s0rows = []
for t in teos:
    h = B.holdings_for_teo(NAME, t)
    if h.get("report_date") != t:
        continue
    end = B.fwd_quarter_end(pd.Timestamp(t))
    if end > B.trading_days().max():
        continue
    renorm, _, cov, n, _ = B.portfolio_window_return(h["holdings"], pd.Timestamp(t), end)
    ep = rows[t].get("portfolio_gross_return")
    if ep is None or np.isnan(renorm):
        continue
    diffs.append(abs(renorm-ep)*1e4); covs.append(cov); s0rows.append((t, ep, renorm, cov, n))
diffs = np.array(diffs)
print(f"  n={len(diffs)} quarters | coverage median={np.median(covs):.1%} min={np.min(covs):.1%}")
print(f"  mean|diff|={diffs.mean():.1f}bps median={np.median(diffs):.1f} max={diffs.max():.1f} "
      f"<75bps={ (diffs<75).sum() }/{len(diffs)}")
GATE = diffs.mean()
if GATE > 75:
    print(f"\n  STAGE 0 FAILED (mean {GATE:.0f}bps > 75). Coverage too thin / high turnover. STOP — not publishing lagged D.E.Shaw layers.")
    verdict = "FAILED"
else:
    print(f"\n  STAGE 0 {'PASS' if GATE<25 else 'PROCEED-WITH-FLAG'} (mean {GATE:.0f}bps).")
    verdict = "PASS" if GATE < 25 else "FLAG"

out = {"stage0_mean_bps": float(GATE), "stage0_median_bps": float(np.median(diffs)),
       "stage0_n": len(diffs), "coverage_median": float(np.median(covs)), "verdict": verdict}

if verdict != "FAILED":
    # ---------- STAGE 1 + 2 + CAPM on the fetched window ----------
    valid = [t for t in teos if B.holdings_for_teo(NAME, t).get("report_date") == t]
    ent = {t: B.entry_date(pd.Timestamp(t)) for t in valid}
    lag_g, unl_g, spyL, spyU = [], [], [], []
    lay_lag = {k: [] for k in ("market","sector","subsector","idio")}
    lay_unl = {k: [] for k in ("market","sector","subsector","idio")}
    tmax = B.trading_days().max()
    for a, b in zip(valid, valid[1:]):
        e_in, e_out = ent[a], ent[b]
        if pd.isna(e_in) or pd.isna(e_out) or e_out > tmax: continue
        h = B.holdings_for_teo(NAME, a)
        q = (e_out - e_in).days/91.3125
        lg, _, _, _, _ = B.portfolio_window_return(h["holdings"], e_in, e_out)
        ug, _, _, _, _ = B.portfolio_window_return(h["holdings"], pd.Timestamp(a), B.fwd_quarter_end(pd.Timestamp(a)))
        ll = B.portfolio_window_layers(h["holdings"], e_in, e_out)
        ul = B.portfolio_window_layers(h["holdings"], pd.Timestamp(a), B.fwd_quarter_end(pd.Timestamp(a)))
        if any(np.isnan(v) for v in [lg, ug]+list(ll.values())+list(ul.values())): continue
        lag_g.append(lg/q); unl_g.append(ug)
        spyL.append(B.spy_window(e_in, e_out)); spyU.append(B.spy_window(pd.Timestamp(a), B.fwd_quarter_end(pd.Timestamp(a))))
        for k, kk in (("market","market"),("sector","sector"),("subsector","subsector"),("idio","idiosyncratic")):
            lay_lag[k].append(ll[kk]/q); lay_unl[k].append(ul[kk])
    def comp(d, keys): return [sum(d[k][i] for k in keys) for i in range(len(d[keys[0]]))]
    ss_l = comp(lay_lag, ["sector","subsector"]); ss_u = comp(lay_unl, ["sector","subsector"])
    di_l = comp(lay_lag, ["market","sector","subsector"]); di_u = comp(lay_unl, ["market","sector","subsector"])
    print(f"\n--- STAGE 1/2: {len(lag_g)} windows ---")
    print(f"  gross:        lag mean={stats(lag_g)['mean_bps']:.0f} Sharpe={stats(lag_g)['sharpe']:.2f} | "
          f"unl mean={stats(unl_g)['mean_bps']:.0f} Sharpe={stats(unl_g)['sharpe']:.2f} | survival={stats(lag_g)['mean_bps']/stats(unl_g)['mean_bps']*100:.0f}%")
    print(f"  sec+subsec:   lag mean={stats(ss_l)['mean_bps']:.0f} Sharpe={stats(ss_l)['sharpe']:.2f} | unl mean={stats(ss_u)['mean_bps']:.0f} Sharpe={stats(ss_u)['sharpe']:.2f}")
    print(f"  drop-idio:    lag Sharpe={stats(di_l)['sharpe']:.2f} | unl Sharpe={stats(di_u)['sharpe']:.2f}")
    # CAPM
    def capm(y, m):
        y, m = np.array(y), np.array(m); X = np.vstack([np.ones_like(m), m]).T
        c, *_ = np.linalg.lstsq(X, y, rcond=None); resid = y - X@c
        s2 = resid@resid/(len(y)-2); cov = s2*np.linalg.inv(X.T@X)
        return c[0]*1e4, c[0]/np.sqrt(cov[0,0]), c[1]
    aL, tL, bL = capm(lag_g, spyL); aU, tU, bU = capm(unl_g, spyU)
    print(f"  CAPM: lagged alpha={aL:.0f}bps t={tL:.2f} beta={bL:.2f} | unlagged alpha={aU:.0f}bps t={tU:.2f} beta={bU:.2f}")
    out.update(dict(n_windows=len(lag_g),
        gross_lag=stats(lag_g), gross_unl=stats(unl_g),
        secsub_lag=stats(ss_l), secsub_unl=stats(ss_u),
        dropidio_lag_sharpe=stats(di_l)["sharpe"], dropidio_unl_sharpe=stats(di_u)["sharpe"],
        capm_lag=dict(alpha=aL,t=tL,beta=bL), capm_unl=dict(alpha=aU,t=tU,beta=bU),
        survival_pct=stats(lag_g)["mean_bps"]/stats(unl_g)["mean_bps"]*100))

    # ---------- loading drift (staleness) for D.E.Shaw ----------
    print("\n--- loading drift over the reporting gap (D.E.Shaw is high-turnover) ---")
    dsec, dsub, dw = [], [], []
    for a, b in zip(valid, valid[1:]):
        ha, hb = B.holdings_for_teo(NAME, a), B.holdings_for_teo(NAME, b)
        def load(h, key):
            tot = sum(x["weight"] for x in h["holdings"] if x.get("ticker") and x.get("weight"))
            return sum((x.get(key) or 0)*(x["weight"] or 0) for x in h["holdings"] if x.get("ticker"))/tot if tot else np.nan
        dsec.append(abs(load(hb,"l3_sector_er")-load(ha,"l3_sector_er")))
        dsub.append(abs(load(hb,"l3_subsector_er")-load(ha,"l3_subsector_er")))
        # weight turnover
        wa={x["ticker"]:x["weight"] for x in ha["holdings"] if x.get("ticker")}
        wb_={x["ticker"]:x["weight"] for x in hb["holdings"] if x.get("ticker")}
        allk=set(wa)|set(wb_); dw.append(sum(abs(wa.get(k,0)-wb_.get(k,0)) for k in allk)/2)
    print(f"  mean |Δ sector ER-load| q-o-q = {np.nanmean(dsec)*1e4:.0f}bps (~{np.nanmean(dsec)*1e4/2:.0f} over 45d)")
    print(f"  mean |Δ subsector ER-load| q-o-q = {np.nanmean(dsub)*1e4:.0f}bps")
    print(f"  mean name-weight turnover q-o-q = {np.nanmean(dw)*100:.0f}% (Berkshire ~few %)")
    out["drift_sector_bps"]=float(np.nanmean(dsec)*1e4); out["drift_subsector_bps"]=float(np.nanmean(dsub)*1e4)
    out["turnover_pct"]=float(np.nanmean(dw)*100)

json.dump(out, open(B._CACHE / "deshaw_results.json", "w"), indent=1, default=str)
print("\nwrote deshaw_results.json")
