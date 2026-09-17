"""Second filer for the lag study — Pershing Square.

WHY PERSHING. The selection rule from HANDOFF §9 is "pick by book concentration, not by
manager profile". Pershing is the most concentrated book available (effective N ~6.9, the
top 10 names ARE the book), has 52 studiable quarters back to the 2013 daily-returns floor,
and has a published external prior: Sammon (2016) ran this exact +45-day lag on Pershing and
found the replicator roughly doubled the market, versus Berkshire's replicator which merely
tracked it. So it is both the best-suited book AND the one with something to check against.

Appaloosa was the alternative but only reaches back to 2016 and is more diffuse (effective N
~12). Greenlight is unusable: its last filing is 2023-12-31 and a quarter of its book is a
confidential-treatment row.

Runs in stages so cost is visible and controllable:
    python run_pershing.py holdings   # holdings only, then report the fetch size
    python run_pershing.py fetch      # returns + decomposition for the union of names
    python run_pershing.py analyse    # Stage 0 gate, then Stage 1/2 ONLY if it passes

The Stage 0 gate is binding here exactly as it was for D. E. Shaw: if the rebuild cannot
reproduce the endpoint's own gross return, nothing downstream is published.
"""
from __future__ import annotations
import sys, json, time, warnings
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
import build_lagged as B

NAME = "Pershing"
FLOOR = "2013-06-01"          # daily-returns floor is 2013-07-29; teos before this are unusable


def teos():
    return [r["teo"] for r in B.portfolio_rows(NAME) if r["teo"] >= FLOOR]


def stage_holdings():
    """Fetch every holdings vintage and report what the returns fetch would cost."""
    ts = teos()
    print(f"[{NAME}] fetching {len(ts)} holdings vintages ...")
    ok, missing = 0, []
    for i, t in enumerate(ts, 1):
        h = B.holdings_for_teo(NAME, t)
        if h.get("report_date") == t:
            ok += 1
        else:
            missing.append(t)
        if i % 10 == 0:
            print(f"    {i}/{len(ts)}")
    union = sorted({x["ticker"] for t in ts
                    for x in B.holdings_for_teo(NAME, t)["holdings"] if x.get("ticker")})
    have_r = [tk for tk in union if (B._CACHE / f"returns_{tk.replace('/', '_')}.json").exists()]
    have_d = [tk for tk in union if (B._CACHE / f"decomp_{tk.replace('/', '_')}.json").exists()]
    need = len(union) * 2 - len(have_r) - len(have_d)
    print(f"\n  books with report_date == teo : {ok}/{len(ts)}")
    print(f"  books missing                 : {missing}")
    print(f"  union of tickers              : {len(union)}")
    print(f"  already cached                : {len(have_r)} returns, {len(have_d)} decomps")
    print(f"  ==> calls needed              : {need}  (~${need * 0.02:.2f} at $0.02/call)")
    (B._CACHE / f"{NAME}_plan.json").write_text(json.dumps(
        {"teos": ts, "union": union, "missing_books": missing, "calls_needed": need}))
    return union


def stage_fetch():
    plan = json.loads((B._CACHE / f"{NAME}_plan.json").read_text())
    union = plan["union"] + ["SPY"]
    t0 = time.time()
    for i, tk in enumerate(union, 1):
        B.returns_series(tk)
        B.decomp_series(tk)
        if i % 10 == 0 or i == len(union):
            print(f"    {i}/{len(union)}  ({time.time()-t0:.0f}s)")
    print(f"  done in {time.time()-t0:.0f}s")


def _gate():
    """Stage 0 with the terminal row dropped (see LAGGED_RESULTS §0.1)."""
    B.CACHE_ONLY = True
    r0 = B.stage0(NAME)
    terminal = B.portfolio_rows(NAME)[-1]["teo"]
    ok = [x for x in r0 if x["book_ok"] and x["diff_renorm_bps"] is not None
          and x["teo"] != terminal]
    d = np.array([x["diff_renorm_bps"] for x in ok])
    cov = np.array([x["covered_w"] for x in ok])
    return {
        "n": len(d), "mean_bps": float(d.mean()), "median_bps": float(np.median(d)),
        "max_bps": float(d.max()), "verdict": B.gate_verdict(float(d.mean())),
        "coverage_median": float(np.median(cov)), "coverage_min": float(cov.min()),
        "terminal_teo": terminal,
        "missing_books": [x["teo"] for x in r0 if not x["book_ok"]],
        "worst": sorted([{"teo": x["teo"], "diff_bps": x["diff_renorm_bps"],
                          "cov": x["covered_w"]} for x in ok],
                        key=lambda z: -z["diff_bps"])[:5],
    }


def stage_analyse():
    B.CACHE_ONLY = True
    g = _gate()
    print("=" * 74)
    print(f"[{NAME}] STAGE 0 VALIDATION GATE")
    print("=" * 74)
    print(f"  n={g['n']}  mean|diff|={g['mean_bps']:.1f} bps  median={g['median_bps']:.1f}  "
          f"max={g['max_bps']:.1f}")
    print(f"  coverage median {g['coverage_median']:.1%} (min {g['coverage_min']:.1%})")
    print(f"  missing books: {g['missing_books']}")
    print(f"  >>> VERDICT: {g['verdict']}")
    for w in g["worst"]:
        print(f"      worst: {w['teo']}  {w['diff_bps']:.0f} bps  cov {w['cov']:.2f}")

    out = {"gate": g}
    if g["verdict"] == "STOP":
        print("\n  Gate FAILED. Publishing nothing downstream, per protocol.")
        (B._CACHE / f"{NAME}_results.json").write_text(json.dumps(out, indent=1, default=str))
        return out

    print(f"\n[{NAME}] gate passed -- running Stage 1 (lagged gross) + Stage 2 (layers)")
    r1 = B.stage1(NAME)
    r1 = [x for x in r1 if x["gross_lagged"] is not None and not np.isnan(x["gross_lagged"])]
    s = {k: B.stats([x[k] for x in r1]) for k in
         ("gross_lagged", "gross_unlagged_rebuild", "spy_lagged_window")}
    print(f"\n  STAGE 1  n={len(r1)} windows")
    print(f"  {'series':<22} {'mean bps':>9} {'t':>6} {'hit%':>6} {'Sharpe':>7} {'ann%':>7}")
    for k, lbl in (("gross_lagged", "lagged"), ("gross_unlagged_rebuild", "unlagged"),
                   ("spy_lagged_window", "SPY (lagged windows)")):
        v = s[k]
        print(f"  {lbl:<22} {v['mean_bps']:>9.1f} {v['t']:>6.2f} {v['hit']:>6.0f} "
              f"{v['sharpe']:>7.2f} {v['ann_pct']:>7.2f}")
    surv = s["gross_lagged"]["mean_bps"] / s["gross_unlagged_rebuild"]["mean_bps"] * 100
    print(f"  survival: {surv:.0f}% of the unlagged gross mean")

    # CAPM
    p = np.array([x["gross_lagged"] for x in r1], float)
    m = np.array([x["spy_lagged_window"] for x in r1], float)
    good = ~(np.isnan(p) | np.isnan(m))
    X = np.column_stack([np.ones(good.sum()), m[good]])
    beta, *_ = np.linalg.lstsq(X, p[good], rcond=None)
    resid = p[good] - X @ beta
    se = np.sqrt(np.diag((resid @ resid) / (good.sum() - 2) * np.linalg.inv(X.T @ X)))
    capm = {"alpha_bps": beta[0] * 1e4, "t_alpha": beta[0] / se[0], "beta": beta[1],
            "t_beta_ne_1": (beta[1] - 1) / se[1], "n": int(good.sum())}
    print(f"  CAPM: alpha={capm['alpha_bps']:+.1f} bps t={capm['t_alpha']:+.2f}  "
          f"beta={capm['beta']:.2f} t(b!=1)={capm['t_beta_ne_1']:+.2f}")

    # Stage 2 layers
    v2 = B.stage2_validate(NAME)
    print(f"\n  STAGE 2 layer validation (median |diff| vs endpoint, 50 bps bar):")
    lay_ok = True
    for k, dd in v2.items():
        flag = "PASS" if dd["median_bps"] < 50 else "FAIL"
        if flag == "FAIL":
            lay_ok = False
        print(f"    {k:<15} mean={dd['mean_bps']:6.1f} median={dd['median_bps']:6.1f} "
              f"(n={dd['n']})  {flag}")

    lay = None
    if lay_ok:
        r2 = B.stage2(NAME)
        r2 = [x for x in r2 if x["market"] is not None and not np.isnan(x["market"])]
        lay = {}
        for lbl, fn in (("market", lambda x: x["market"]), ("sector", lambda x: x["sector"]),
                        ("subsector", lambda x: x["subsector"]), ("idio", lambda x: x["idio"]),
                        ("sector_plus_subsector", lambda x: x["sector"] + x["subsector"]),
                        ("drop_idio", lambda x: x["market"] + x["sector"] + x["subsector"]),
                        ("gross", lambda x: x["gross"])):
            lay[lbl] = B.stats([fn(x) / x["q_len"] for x in r2])
        print(f"\n  STAGE 2 lagged layer attribution (q_len-normalised, n={len(r2)}):")
        print(f"  {'layer':<24} {'mean bps':>9} {'t':>6} {'hit%':>6} {'Sharpe':>7}")
        for k, v in lay.items():
            print(f"  {k:<24} {v['mean_bps']:>9.1f} {v['t']:>6.2f} {v['hit']:>6.0f} "
                  f"{v['sharpe']:>7.2f}")
    else:
        print("\n  Layer gate FAILED -> layer attribution withheld.")

    out.update({"stage1": s, "survival_pct": surv, "capm": capm,
                "layer_validation": v2, "layers": lay, "n_windows": len(r1)})
    (B._CACHE / f"{NAME}_results.json").write_text(json.dumps(out, indent=1, default=str))
    print(f"\nwrote cache/{NAME}_results.json")
    return out


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "holdings"
    {"holdings": stage_holdings, "fetch": stage_fetch, "analyse": stage_analyse}[cmd]()
