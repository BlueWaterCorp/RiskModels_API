"""1C -- strip market beta out of the D. E. Shaw regime split.

The §5 regime result found the post-report drift WEAKEST per unit weight in Leading
sectors (+71 bps) and strongest in the turning quadrants (Improving +175, Weakening
+192), with a paired Leading-minus-Weakening difference of -136 bps (t=-2.73).

That result decomposes a mostly-beta return: the whole book's window-A return is
levered market beta with ~zero alpha (alpha t=-0.64, beta 1.29). Sectors differ in
beta, so a per-quadrant return difference can be nothing more than "these quadrants
held higher-beta sectors in these particular windows".

This script settles it. For each quadrant basket, regress the basket's own window
return on SPY's return over the IDENTICAL window, across quarters:

    R_quadrant,t = alpha + beta * R_SPY,t + e_t

If the quadrant differences survive as alpha, the regime finding is real. If they
collapse into beta, §5 must be rewritten to report the differences as beta.

Hermetic: reads the two per-quarter CSVs, no cache or network.
Run:  python deshaw_regime_beta.py
"""
from __future__ import annotations
import json
from pathlib import Path

import numpy as np
import pandas as pd

_HERE = Path(__file__).resolve().parent
QUADS = ("Leading", "Improving", "Weakening", "Lagging")
WINDOWS = ("A_1_10", "E_45_55")


def ols(y, x):
    """Univariate OLS with HC0 (White) robust standard errors.

    Robust SEs because the window returns are heteroskedastic across quarters
    (high-vol quarters such as 2020-Q1 dominate); classical SEs would overstate
    precision.
    """
    y = np.asarray(y, float)
    x = np.asarray(x, float)
    ok = ~(np.isnan(y) | np.isnan(x))
    y, x = y[ok], x[ok]
    n = len(y)
    if n < 5:
        return None
    X = np.column_stack([np.ones(n), x])
    XtX_inv = np.linalg.inv(X.T @ X)
    beta = XtX_inv @ X.T @ y
    resid = y - X @ beta
    # HC0 sandwich
    S = (X * (resid ** 2)[:, None]).T @ X
    cov = XtX_inv @ S @ XtX_inv
    se = np.sqrt(np.diag(cov))
    ss_tot = ((y - y.mean()) ** 2).sum()
    return {
        "n": n,
        "alpha_bps": float(beta[0] * 1e4),
        "se_alpha_bps": float(se[0] * 1e4),
        "t_alpha": float(beta[0] / se[0]),
        "beta": float(beta[1]),
        "se_beta": float(se[1]),
        "t_beta_ne_1": float((beta[1] - 1) / se[1]),
        "r2": float(1 - (resid @ resid) / ss_tot) if ss_tot > 0 else np.nan,
        "mean_ret_bps": float(y.mean() * 1e4),
    }


def paired_alpha(df, wkey, q_big, q_small):
    """Regress the PAIRED quadrant difference on SPY.

    The §5 headline was a paired t-test on (Leading - Weakening) raw returns. If that
    difference is a beta difference, the paired series will load on SPY and its alpha
    will be insignificant. A difference that is genuinely about regime should have
    beta ~ 0 (the market exposure cancels in the difference) and retain its alpha.
    """
    d = df[f"{wkey}_{q_big}_ret"] - df[f"{wkey}_{q_small}_ret"]
    spy = df[f"{wkey}_spy"]
    raw = d.dropna()
    t_raw = raw.mean() / (raw.std(ddof=1) / np.sqrt(len(raw))) if len(raw) > 1 else np.nan
    r = ols(d, spy)
    return {"pair": f"{q_big} - {q_small}", "raw_mean_bps": float(raw.mean() * 1e4),
            "raw_t": float(t_raw), "n_raw": int(len(raw)), "regression": r}


def main():
    reg = pd.read_csv(_HERE / "deshaw_regime_sector.csv")
    rd = pd.read_csv(_HERE / "deshaw_report_date.csv")
    df = reg.merge(rd[["report_date", "coverage"] +
                      [f"{w}_spy" for w in WINDOWS] +
                      [f"{w}_port" for w in WINDOWS]],
                   on="report_date", how="inner")
    print("=" * 88)
    print("1C -- D. E. SHAW REGIME SPLIT, BETA-ADJUSTED")
    print(f"     n={len(df)} report dates | sector-level labels | HC0 robust SEs")
    print(f"     mapping coverage median {df['map_coverage'].median():.1%}, "
          f"return coverage median {df['coverage'].median():.1%}")
    print("=" * 88)

    out = {"n": int(len(df)), "windows": {}}
    for w in WINDOWS:
        print(f"\n--- window {w} --- (basket return regressed on SPY over the same window)")
        print(f"    {'quadrant':<11} {'mean w':>7} {'raw ret':>9} | {'alpha':>9} {'t(a)':>7} "
              f"{'beta':>6} {'t(b!=1)':>8} {'R2':>6}")
        wres = {}
        for q in QUADS:
            r = ols(df[f"{w}_{q}_ret"], df[f"{w}_spy"])
            mw = df[f"{w}_{q}_weight"].mean()
            wres[q] = {"mean_weight": float(mw), **(r or {})}
            if r:
                print(f"    {q:<11} {mw:>6.1%} {r['mean_ret_bps']:>+9.0f} | "
                      f"{r['alpha_bps']:>+9.0f} {r['t_alpha']:>+7.2f} "
                      f"{r['beta']:>6.2f} {r['t_beta_ne_1']:>+8.2f} {r['r2']:>6.2f}")

        # the paired comparison §5 actually reported: largest-weight vs smallest-weight
        mws = {q: df[f"{w}_{q}_weight"].mean() for q in QUADS}
        big, small = max(mws, key=mws.get), min(mws, key=mws.get)
        pr = paired_alpha(df, w, big, small)
        print(f"\n    PAIRED {pr['pair']} (largest-weight minus smallest-weight quadrant)")
        print(f"      raw difference   {pr['raw_mean_bps']:>+7.0f} bps  t={pr['raw_t']:>+5.2f}  "
              f"(n={pr['n_raw']})   <- the figure published in §5")
        if pr["regression"]:
            g = pr["regression"]
            print(f"      beta-adjusted    alpha={g['alpha_bps']:>+6.0f} bps  t={g['t_alpha']:>+5.2f}  "
                  f"beta={g['beta']:>+5.2f} (se {g['se_beta']:.2f})  R2={g['r2']:.2f}")
        wres["_paired"] = pr

        # all six pairwise alphas, so the multiple-comparison bar is explicit
        pairs = []
        for i in range(len(QUADS)):
            for j in range(i + 1, len(QUADS)):
                p = paired_alpha(df, w, QUADS[i], QUADS[j])
                pairs.append(p)
        print(f"\n      all 6 pairwise differences (Bonferroni |t| bar for 6 tests at 5% ~ 2.64):")
        print(f"      {'pair':<25} {'raw bps':>9} {'raw t':>7} | {'alpha bps':>10} {'t(alpha)':>9} {'beta':>7}")
        for p in pairs:
            g = p["regression"]
            flag = "  *" if g and abs(g["t_alpha"]) >= 2.64 else ""
            print(f"      {p['pair']:<25} {p['raw_mean_bps']:>+9.0f} {p['raw_t']:>+7.2f} | "
                  f"{g['alpha_bps']:>+10.0f} {g['t_alpha']:>+9.2f} {g['beta']:>+7.2f}{flag}")
        wres["_all_pairs"] = pairs
        out["windows"][w] = wres

    (_HERE / "cache" / "deshaw_regime_beta.json").write_text(json.dumps(out, indent=1, default=str))
    print("\nwrote cache/deshaw_regime_beta.json")
    return out


if __name__ == "__main__":
    main()
