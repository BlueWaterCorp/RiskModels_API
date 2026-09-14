"""D. E. Shaw report-date window study (Conrad, 2026-08-10).

CHARACTERISATION, NOT A BACKTEST. For every studiable report date we measure what the
DISCLOSED book does over short TRADING-day windows immediately after quarter-end. The book
is not public until ~45 days later, so the +1..+10 window is NOT tradeable. This code
characterises how D. E. Shaw positions INTO quarter-end; it is not a strategy P&L.

Reuses build_lagged low-level helpers (holdings/returns/decomp, all cached). Never live-fetches
during analysis (CACHE_ONLY) — a partially-fetched universe yields partial coverage, reported
on every result rather than silently filled.

Stages (all resumable from cache):
  0  achievable window: floors (returns / decomp / holdings), studiable report-date count
  1  report-date window returns A..E, portfolio + SPY + excess
  2  control: post-report window vs typical 10-day windows in the same quarter
  3  layer decomposition of each window (validated vs endpoint unlagged layer returns first)
  4  quarter-end (fiscal-quarter) split, with the multiple-comparisons caveat

Run:  python deshaw_report_date.py            (analysis on cached universe)
"""
from __future__ import annotations
import riskmodels  # import-order shim: real 0.3.11 before sdk/ on path
import sys, json, glob, warnings
from pathlib import Path
_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
import numpy as np
import pandas as pd
import build_lagged as B

warnings.filterwarnings("ignore")
B.CACHE_ONLY = True  # analysis never fetches uncached names — partial coverage is reported, not filled

NAME = "DEShaw"
RETURNS_FLOOR = "2013-07-29"   # empirical get_ticker_returns floor (see Stage 0)

# Trading-day offset windows after the report-date anchor (last trading day <= teo).
# (d_start, d_end) inclusive in trading days; window covers days [+d_start .. +d_end].
WINDOWS = {
    "A_1_10":  (1, 10),   # Conrad's ask
    "B_1_5":   (1, 5),    # is the effect front-loaded
    "C_1_21":  (1, 21),   # does it persist a month
    "D_35_45": (35, 45),  # run-up to becoming public
    "E_45_55": (45, 55),  # the 10 days AFTER it is public (the commercial window)
}
WIN_ORDER = ["A_1_10", "B_1_5", "C_1_21", "D_35_45", "E_45_55"]
# Control windows: non-overlapping 10-day windows drawn from later in the SAME quarter,
# day +11..+50. Matches window A's length so the comparison is like-for-like.
CONTROL_STARTS = [11, 21, 31, 41]  # -> +11..20, +21..30, +31..40, +41..50


# ---------------- anchor + window plumbing ----------------
def anchor_pos(teo):
    """Integer position of the report-date anchor (last trading day <= teo) in the SPY calendar.
    Returns -1 if teo is before the calendar starts (no returns to measure)."""
    td = B.trading_days()
    pos = int(td.searchsorted(pd.Timestamp(teo), side="right")) - 1
    return pos


def win_bounds(teo, d_start, d_end):
    """(start, end] date bounds for trading-day offsets [+d_start .. +d_end] after the anchor.
    None if either endpoint falls outside the available calendar."""
    td = B.trading_days()
    pos = anchor_pos(teo)
    if pos < 0:
        return None
    lo, hi = pos + d_start - 1, pos + d_end
    if lo < 0 or hi >= len(td):
        return None
    return td[lo], td[hi]


def valid_teos():
    """Studiable report dates: report_date == teo (book exists) AND anchor+max-window in calendar."""
    rows = B.portfolio_rows(NAME)
    out = []
    for r in rows:
        t = r["teo"]
        if t < "2013-08-01":
            continue
        h = B.holdings_for_teo(NAME, t)
        if h.get("report_date") != t:
            continue
        if win_bounds(t, 45, 55) is None:   # need the full E window to be in range
            continue
        out.append(t)
    return out


# ---------------- stat helpers ----------------
def agg(x):
    """mean/std/t/hit over a sample of per-quarter returns (returns in decimal)."""
    x = np.asarray([v for v in x if v is not None and not (isinstance(v, float) and np.isnan(v))])
    if len(x) < 2:
        return dict(n=len(x), mean_bps=np.nan, std_bps=np.nan, t=np.nan, hit=np.nan)
    m, sd = x.mean(), x.std(ddof=1)
    return dict(n=len(x), mean_bps=m * 1e4, std_bps=sd * 1e4,
                t=m / (sd / np.sqrt(len(x))) if sd > 0 else np.nan,
                hit=float((x > 0).mean() * 100))


# ---------------- Stage 1 + 3: per-quarter window returns + layers ----------------
def per_quarter_rows(teos):
    """One record per studiable report date: portfolio + SPY return for each window, coverage,
    and the window-A/E layer split. All windows use the SAME disclosed book for that teo."""
    recs = []
    for t in teos:
        h = B.holdings_for_teo(NAME, t)
        rec = {"report_date": t, "q": pd.Timestamp(t).quarter}
        cov_a = np.nan
        n_a = 0
        for w in WIN_ORDER:
            ds, de = WINDOWS[w]
            b = win_bounds(t, ds, de)
            if b is None:
                rec[f"{w}_port"] = np.nan
                rec[f"{w}_spy"] = np.nan
                continue
            start, end = b
            port, _, cov, n, _ = B.portfolio_window_return(h["holdings"], start, end)
            spy = B.spy_window(start, end)
            rec[f"{w}_port"] = port
            rec[f"{w}_spy"] = spy
            if w == "A_1_10":
                cov_a, n_a = cov, n
        rec["coverage"] = cov_a
        rec["n_names"] = n_a
        # layer split for the two headline windows (A = ask, E = commercial)
        for w in ("A_1_10", "E_45_55"):
            ds, de = WINDOWS[w]
            b = win_bounds(t, ds, de)
            if b is None:
                for k in ("market", "sector", "subsector", "idio"):
                    rec[f"{w}_{k}"] = np.nan
                continue
            lay = B.portfolio_window_layers(h["holdings"], b[0], b[1])
            rec[f"{w}_market"] = lay["market"]
            rec[f"{w}_sector"] = lay["sector"]
            rec[f"{w}_subsector"] = lay["subsector"]
            rec[f"{w}_idio"] = lay["idiosyncratic"]
        recs.append(rec)
    return recs


# ---------------- Stage 2: control windows ----------------
def control_analysis(teos):
    """Is the post-report +1..+10 window distinguishable from a typical 10-day window in the
    same quarter for the same book? Paired (per-quarter A minus that quarter's control mean),
    pooled (all A vs all controls), and the mean percentile of A within its quarter's controls."""
    paired = []       # A - mean(controls in same quarter)
    all_a = []
    all_ctrl = []
    pctls = []
    for t in teos:
        h = B.holdings_for_teo(NAME, t)
        ba = win_bounds(t, 1, 10)
        if ba is None:
            continue
        a, _, _, _, _ = B.portfolio_window_return(h["holdings"], ba[0], ba[1])
        if a is None or np.isnan(a):
            continue
        ctrls = []
        for s in CONTROL_STARTS:
            b = win_bounds(t, s, s + 9)
            if b is None:
                continue
            c, _, _, _, _ = B.portfolio_window_return(h["holdings"], b[0], b[1])
            if c is not None and not np.isnan(c):
                ctrls.append(c)
        if len(ctrls) < 2:
            continue
        all_a.append(a)
        all_ctrl.extend(ctrls)
        paired.append(a - np.mean(ctrls))
        # percentile of A within this quarter's control set
        pctls.append(100.0 * np.mean([a > c for c in ctrls]))
    a_arr, c_arr = np.asarray(all_a), np.asarray(all_ctrl)
    # pooled percentile of the mean post-report return within the pooled control distribution
    pooled_pctl = 100.0 * np.mean(c_arr < a_arr.mean()) if len(c_arr) else np.nan
    return {
        "n_quarters": len(paired),
        "post_report": agg(all_a),
        "control_pooled": agg(all_ctrl),
        "paired_diff": agg(paired),           # A - control mean, per quarter
        "mean_percentile": float(np.mean(pctls)) if pctls else np.nan,
        "pooled_percentile_of_mean": float(pooled_pctl),
    }


# ---------------- dropped-quarter accounting ----------------
def dropped_quarter_report(teos, recs):
    """Account for every studiable report date that did NOT produce a window return, with the
    specific reason, and test whether the dropped set differs systematically from the retained
    set on the endpoint's own gross quarterly return (no rebuild needed)."""
    by_teo = {r["report_date"]: r for r in recs}
    rows = {r["teo"]: r for r in B.portfolio_rows(NAME)}
    kept, dropped = [], []
    for t in teos:
        r = by_teo.get(t)
        port = r["A_1_10_port"] if r else np.nan
        if port is not None and not np.isnan(port):
            kept.append(t)
        else:
            # classify the reason
            if r is None:
                reason = "no record"
            elif np.isnan(r.get("coverage", np.nan)) or r.get("n_names", 0) == 0:
                reason = "zero covered names (not in cached universe)"
            else:
                reason = f"portfolio return NaN despite {r['coverage']:.0%} coverage (NaN-day poisoning)"
            dropped.append({"report_date": t, "reason": reason,
                            "coverage": None if r is None else r.get("coverage"),
                            "n_names": None if r is None else r.get("n_names")})
    def endpoint_gross(tset):
        v = [rows[t]["portfolio_gross_return"] for t in tset
             if t in rows and rows[t].get("portfolio_gross_return") is not None]
        v = np.asarray(v)
        return {"n": len(v), "mean_pct": float(v.mean() * 100) if len(v) else np.nan,
                "std_pct": float(v.std(ddof=1) * 100) if len(v) > 1 else np.nan}
    gk = endpoint_gross(kept)
    gd = endpoint_gross([d["report_date"] for d in dropped])
    # Welch t on the difference in endpoint gross between kept and dropped
    diff_t = np.nan
    if gk["n"] > 1 and gd["n"] > 1:
        se = np.sqrt(gk["std_pct"] ** 2 / gk["n"] + gd["std_pct"] ** 2 / gd["n"])
        diff_t = (gk["mean_pct"] - gd["mean_pct"]) / se if se > 0 else np.nan
    return {"n_studiable": len(teos), "n_kept": len(kept), "n_dropped": len(dropped),
            "dropped": dropped, "endpoint_gross_kept": gk, "endpoint_gross_dropped": gd,
            "kept_vs_dropped_gross_t": float(diff_t) if not np.isnan(diff_t) else None}


# ---------------- window regressions (CAPM per window) ----------------
def window_regression(recs, wkey):
    """OLS of the book's window return on SPY's window return across quarters.
    Returns alpha(bps), t(alpha), beta, t(beta), n. Answers: is the window's excess real once
    beta is accounted for, and does beta differ between the pre- and post-disclosure windows?"""
    y, x = [], []
    for r in recs:
        p, s = r.get(f"{wkey}_port"), r.get(f"{wkey}_spy")
        if p is None or s is None or np.isnan(p) or np.isnan(s):
            continue
        y.append(p); x.append(s)
    y, x = np.asarray(y), np.asarray(x)
    if len(y) < 3:
        return {"n": len(y)}
    X = np.vstack([np.ones_like(x), x]).T
    c, *_ = np.linalg.lstsq(X, y, rcond=None)
    resid = y - X @ c
    s2 = resid @ resid / (len(y) - 2)
    cov = s2 * np.linalg.inv(X.T @ X)
    return {"n": len(y), "alpha_bps": float(c[0] * 1e4), "t_alpha": float(c[0] / np.sqrt(cov[0, 0])),
            "beta": float(c[1]), "t_beta": float(c[1] / np.sqrt(cov[1, 1])),
            "t_beta_ne_1": float((c[1] - 1.0) / np.sqrt(cov[1, 1]))}


def bonferroni_quarters(q_stats, alpha=0.05, n_tests=4):
    """Bonferroni-adjusted two-sided t threshold for the 4-way fiscal-quarter split, and whether
    each quarter's |t| clears it. df per bucket ~ n-1; we report the large-n normal approx
    threshold as the primary and the smallest-bucket t-threshold as the conservative check."""
    from math import erf, sqrt
    # invert two-sided normal for alpha/n_tests
    p = 1 - (alpha / n_tests) / 2
    # Newton on Phi(z)=p
    z = 2.5
    for _ in range(60):
        Phi = 0.5 * (1 + erf(z / sqrt(2)))
        pdf = (1 / sqrt(2 * 3.141592653589793)) * np.exp(-z * z / 2)
        z -= (Phi - p) / pdf
    crit = float(z)
    out = {"alpha": alpha, "n_tests": n_tests, "bonferroni_p": alpha / n_tests,
           "crit_t_normal": crit, "per_quarter": {}}
    for q, s in q_stats.items():
        tval = s.get("t")
        out["per_quarter"][str(q)] = {"t": tval, "n": s.get("n"),
                                      "clears_bonferroni": bool(tval is not None and not np.isnan(tval) and abs(tval) >= crit)}
    return out


# ---------------- Stage 3 validation ----------------
def validate_layers():
    """Reproduce the endpoint's UNLAGGED quarterly layer returns for D. E. Shaw before trusting
    any windowed layer figure. Passes build_lagged.stage2_validate (covered-name renormalised)."""
    return B.stage2_validate(NAME)


# ---------------- driver ----------------
def stage0():
    rows = B.portfolio_rows(NAME)
    teos_all = [r["teo"] for r in rows]
    studiable = valid_teos()
    ncached = len(glob.glob(str(B._CACHE / "returns_*.json")))
    dcached = len(glob.glob(str(B._CACHE / "decomp_*.json")))
    return {
        "portfolio_teos": len(teos_all), "portfolio_range": [teos_all[0], teos_all[-1]],
        "returns_floor": RETURNS_FLOOR, "decomp_floor": "2011-07-27",
        "studiable_teos": len(studiable),
        "studiable_range": [studiable[0], studiable[-1]] if studiable else None,
        "returns_cached": ncached, "decomp_cached": dcached,
        "studiable": studiable,
    }


def main():
    s0 = stage0()
    print("=== STAGE 0 — achievable window ===")
    print(f"  D.E.Shaw portfolio series: {s0['portfolio_teos']} teos {s0['portfolio_range']}")
    print(f"  returns floor {s0['returns_floor']} | decomp floor {s0['decomp_floor']}")
    print(f"  STUDIABLE report dates (book exists, +55d window in range): {s0['studiable_teos']}"
          f" {s0['studiable_range']}")
    print(f"  cached universe: {s0['returns_cached']} returns / {s0['decomp_cached']} decomp series")

    teos = s0["studiable"]
    recs = per_quarter_rows(teos)
    covs = [r["coverage"] for r in recs if not np.isnan(r["coverage"])]
    print(f"\n  coverage (window A, weight of book with cached returns): "
          f"median={np.median(covs):.1%} min={np.min(covs):.1%} max={np.max(covs):.1%}")

    drop = dropped_quarter_report(teos, recs)
    print(f"\n  EFFECTIVE n = {drop['n_kept']} of {drop['n_studiable']} studiable "
          f"({drop['n_dropped']} dropped)")
    for d in drop["dropped"]:
        print(f"    dropped {d['report_date']}: {d['reason']}")
    gk, gd = drop["endpoint_gross_kept"], drop["endpoint_gross_dropped"]
    print(f"  dropped vs kept — endpoint gross quarterly return: "
          f"kept mean={gk['mean_pct']:.2f}% (n={gk['n']}) | dropped mean={gd['mean_pct']:.2f}% (n={gd['n']}) "
          f"| diff t={drop['kept_vs_dropped_gross_t']}")

    print("\n=== STAGE 1 — report-date window returns (portfolio / SPY / excess) ===")
    win_stats = {}
    for w in WIN_ORDER:
        port = [r[f"{w}_port"] for r in recs]
        spy = [r[f"{w}_spy"] for r in recs]
        exc = [(p - s) if (p is not None and s is not None and not np.isnan(p) and not np.isnan(s))
               else np.nan for p, s in zip(port, spy)]
        sp, ss, se = agg(port), agg(spy), agg(exc)
        win_stats[w] = {"port": sp, "spy": ss, "excess": se}
        ds, de = WINDOWS[w]
        print(f"  {w:8} (+{ds}..+{de}): port mean={sp['mean_bps']:7.1f}bps t={sp['t']:5.2f} "
              f"hit={sp['hit']:4.0f}% | SPY={ss['mean_bps']:7.1f} | "
              f"excess={se['mean_bps']:7.1f}bps t={se['t']:5.2f} hit={se['hit']:4.0f}% (n={sp['n']})")

    print("\n=== STAGE 2 — control: post-report vs typical 10-day window (same quarter) ===")
    ctrl = control_analysis(teos)
    pr, cp, pd_ = ctrl["post_report"], ctrl["control_pooled"], ctrl["paired_diff"]
    print(f"  post-report +1..10 : mean={pr['mean_bps']:7.1f}bps hit={pr['hit']:4.0f}% (n={pr['n']})")
    print(f"  control 10-day pool: mean={cp['mean_bps']:7.1f}bps hit={cp['hit']:4.0f}% (n={cp['n']})")
    print(f"  PAIRED (A - control mean/quarter): mean={pd_['mean_bps']:7.1f}bps t={pd_['t']:5.2f} "
          f"hit={pd_['hit']:4.0f}% (n={pd_['n']})")
    print(f"  mean percentile of A within quarter's controls: {ctrl['mean_percentile']:.0f}th")
    print(f"  pooled percentile of mean-A within control pool: {ctrl['pooled_percentile_of_mean']:.0f}th")

    print("\n=== window regressions (book ~ SPY, per window) ===")
    regs = {}
    for w in ("A_1_10", "E_45_55"):
        r = window_regression(recs, w)
        regs[w] = r
        if "alpha_bps" in r:
            print(f"  {w}: alpha={r['alpha_bps']:.1f}bps t={r['t_alpha']:.2f} | beta={r['beta']:.2f} "
                  f"t(beta)={r['t_beta']:.2f} t(beta≠1)={r['t_beta_ne_1']:.2f} (n={r['n']})")

    print("\n=== STAGE 3 — layer decomposition (validate first) ===")
    val = validate_layers()
    for k, d in val.items():
        print(f"  validate {k:12} mean|diff|={d['mean_bps']:6.1f}bps median={d['median_bps']:6.1f} (n={d['n']})")
    val_ok = all(d["median_bps"] < 50 for d in val.values())
    print(f"  validation: {'PASS (medians <50bps)' if val_ok else 'FAIL — layer figures NOT trusted'}")
    layer_stats = {}
    if val_ok:
        for w in ("A_1_10", "E_45_55"):
            row = {}
            for k in ("market", "sector", "subsector", "idio"):
                row[k] = agg([r[f"{w}_{k}"] for r in recs])
            layer_stats[w] = row
            ds, de = WINDOWS[w]
            print(f"  {w} (+{ds}..+{de}) layer means bps: "
                  f"market={row['market']['mean_bps']:.1f} sector={row['sector']['mean_bps']:.1f} "
                  f"subsector={row['subsector']['mean_bps']:.1f} idio={row['idio']['mean_bps']:.1f}")

    print("\n=== STAGE 4 — fiscal-quarter split (multiple-comparisons caveat) ===")
    q_stats = {}
    for q in (1, 2, 3, 4):
        port = [r["A_1_10_port"] for r in recs if r["q"] == q]
        s = agg(port)
        q_stats[q] = s
        print(f"  Q{q} (report month {'Mar Jun Sep Dec'.split()[q-1]}): "
              f"A mean={s['mean_bps']:7.1f}bps t={s['t']:5.2f} hit={s['hit']:4.0f}% (n={s['n']})")
    bonf = bonferroni_quarters(q_stats)
    print(f"  Bonferroni: {bonf['n_tests']} tests, α={bonf['alpha']} → per-test p={bonf['bonferroni_p']:.4f}, "
          f"critical |t| ≈ {bonf['crit_t_normal']:.2f}")
    for q in (1, 2, 3, 4):
        pc = bonf["per_quarter"][str(q)]
        print(f"    Q{q}: |t|={abs(pc['t']):.2f} {'CLEARS' if pc['clears_bonferroni'] else 'does NOT clear'} "
              f"the {bonf['crit_t_normal']:.2f} bar")
    print("  NOTE: 4-way split quarters the sample and multiplies tests; no single quarter is a")
    print("        finding without the multiple-comparisons discount.")

    # ---- write CSV + results JSON ----
    _write_csv(recs)
    out = {
        "stage0": {k: v for k, v in s0.items() if k != "studiable"},
        "coverage": {"median": float(np.median(covs)), "min": float(np.min(covs)), "max": float(np.max(covs))},
        "windows": win_stats, "control": ctrl,
        "layer_validation": val, "layer_validation_pass": val_ok, "layers": layer_stats,
        "quarter_split": {str(q): s for q, s in q_stats.items()},
        "n_studiable": len(teos),
        "dropped_quarters": drop, "regressions": regs, "bonferroni": bonf,
    }
    json.dump(out, open(B._CACHE / "deshaw_report_date_results.json", "w"), indent=1, default=str)
    print(f"\nwrote cache/deshaw_report_date_results.json and deshaw_report_date.csv "
          f"({len(recs)} report dates)")
    return out, recs


def _write_csv(recs):
    cols = ["report_date", "q", "n_names", "coverage"]
    for w in WIN_ORDER:
        cols += [f"{w}_port", f"{w}_spy"]
    for w in ("A_1_10", "E_45_55"):
        cols += [f"{w}_market", f"{w}_sector", f"{w}_subsector", f"{w}_idio"]
    df = pd.DataFrame(recs)[cols]
    # add excess columns next to each window pair
    for w in WIN_ORDER:
        df[f"{w}_excess"] = df[f"{w}_port"] - df[f"{w}_spy"]
    df.to_csv(_HERE / "deshaw_report_date.csv", index=False, float_format="%.6f")


if __name__ == "__main__":
    main()
