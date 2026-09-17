"""Berkshire re-audit — rebuild every published Berkshire number on the fixed code.

Why this exists: two bugs invalidated the earlier Berkshire deliverable.

  1. NaN-day poisoning in ``build_lagged.window_return`` (fixed 2026-08-17) silently
     nulled whole quarters. Published Stage 1 ran on n=35 windows.
  2. TERMINAL-ROW defect in ``get_filer_portfolio`` (found 2026-09-07, this script).
     The LAST row of a filer's portfolio series carries a forward return measured
     over an OPEN-ENDED window (teo -> the engine's data horizon), not the clean
     (teo, teo+1Q] forward quarter every other row uses. Proof: regress the row's
     ``portfolio_market_return`` on SPY over candidate windows -- Greenlight's
     terminal row (last filing 2023-12-31) matches SPY over 9.2 quarters, and
     Berkshire's 2025-12-31 row matches ~1.9 quarters. Every non-terminal row
     matches its own forward quarter to ~60 bps median.

     Consequence: the terminal row must be dropped from any quarter-aligned
     analysis. It is NOT a rebuild failure -- the rebuild is right and the
     endpoint row is measuring something else.

Run:  python reaudit_berkshire.py          (cache-only, no API spend)
Out:  cache/reaudit_berkshire.json + printed tables
"""
from __future__ import annotations
import sys, json, warnings
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
import build_lagged as B

B.CACHE_ONLY = True  # never spend; the cache is warm for Berkshire

NAME = "Berkshire"
EP_COLS = {
    "market": "portfolio_market_return",
    "sector": "portfolio_sector_return",
    "subsector": "portfolio_subsector_return",
    "idiosyncratic": "portfolio_idiosyncratic_return",
}


# --------------------------------------------------------------------------
# terminal-row diagnostic
# --------------------------------------------------------------------------
def terminal_row_evidence():
    """Quantify the terminal-row defect across all five filers.

    For each filer, compare every row's ``portfolio_market_return`` against SPY
    over that row's own forward quarter. The market layer is ~SPY by construction
    (market-layer Sharpe 0.84 vs SPY 0.82 -- see DATA_ISSUES), so a row whose
    market return diverges from SPY by many sigma is not measuring its stated
    window.
    """
    s_spy = B._ret("SPY")
    tmax = B.trading_days().max()
    out = {}
    for name in B.FILERS:
        rows = B.portfolio_rows(name)
        devs = []
        for r in rows:
            t = pd.Timestamp(r["teo"])
            e = t + pd.DateOffset(months=3)
            if e > tmax:
                continue
            spy = B.window_return("SPY", t, e)
            m = r.get("portfolio_market_return")
            if spy is None or m is None:
                continue
            devs.append((r["teo"], m, spy, (m - spy) * 1e4))
        if len(devs) < 3:
            continue
        prior = np.abs([d[3] for d in devs[:-1]])
        teo, m, spy, dev = devs[-1]
        # what forward horizon WOULD reproduce the terminal row's market return?
        t = pd.Timestamp(teo)
        cum = (1 + s_spy[s_spy.index > t]).cumprod() - 1
        best = (cum - m).abs().idxmin() if len(cum) else None
        out[name] = {
            "n_rows": len(devs),
            "terminal_teo": teo,
            "terminal_dev_bps": dev,
            "prior_mean_abs_dev_bps": float(prior.mean()),
            "prior_median_abs_dev_bps": float(np.median(prior)),
            "prior_max_abs_dev_bps": float(prior.max()),
            "dev_vs_prior_median_x": abs(dev) / float(np.median(prior)),
            "implied_horizon_quarters": (best - t).days / 91.3125 if best is not None else None,
            "implied_window_end": str(best.date()) if best is not None else None,
        }
    return out


# --------------------------------------------------------------------------
# Stage 0 -- validation gate
# --------------------------------------------------------------------------
def stage0_audit():
    r0 = B.stage0(NAME)
    rows = B.portfolio_rows(NAME)
    terminal_teo = rows[-1]["teo"]

    ok = [x for x in r0 if x["book_ok"] and x["diff_renorm_bps"] is not None]
    ok_ex = [x for x in ok if x["teo"] != terminal_teo]

    def summarise(recs, label):
        d = np.array([x["diff_renorm_bps"] for x in recs])
        return {
            "label": label, "n": len(d), "mean_bps": float(d.mean()),
            "median_bps": float(np.median(d)), "max_bps": float(d.max()),
            "n_under_25": int((d < 25).sum()), "n_under_75": int((d < 75).sum()),
            "verdict": ("CLEAN (<25)" if d.mean() < 25
                        else "PROCEED WITH FLAG (25-75)" if d.mean() < 75
                        else "STOP (>75)"),
        }

    return {
        "terminal_teo": terminal_teo,
        "with_terminal": summarise(ok, "all buildable incl. terminal row"),
        "without_terminal": summarise(ok_ex, "all buildable, terminal row dropped"),
        "missing_book_teos": [x["teo"] for x in r0 if not x["book_ok"]],
        "worst": sorted(
            [{"teo": x["teo"], "diff_bps": x["diff_renorm_bps"],
              "endpoint": x["endpoint_gross"], "rebuild": x["rebuild_renorm"],
              "cov": x["covered_w"]} for x in ok],
            key=lambda z: -z["diff_bps"])[:8],
    }


# --------------------------------------------------------------------------
# Stage 1 -- lagged gross
# --------------------------------------------------------------------------
def stage1_audit():
    r1 = B.stage1(NAME)
    out = {"n_windows": len(r1),
           "n_multi_quarter": sum(1 for x in r1 if x["q_len"] > 1.4),
           "first_entry": r1[0]["entry_date"], "last_exit": r1[-1]["exit_date"]}
    for key, lbl in (("gross_lagged", "lagged"),
                     ("gross_unlagged_rebuild", "unlagged_rebuild"),
                     ("gross_unlagged_endpoint", "unlagged_endpoint"),
                     ("spy_lagged_window", "spy_lagged"),
                     ("spy_unlagged_window", "spy_unlagged")):
        out[lbl] = B.stats([x[key] for x in r1])
    out["survival_pct"] = out["lagged"]["mean_bps"] / out["unlagged_rebuild"]["mean_bps"] * 100

    # CAPM on the lagged and unlagged rebuilds
    for lbl, pkey, skey in (("capm_lagged", "gross_lagged", "spy_lagged_window"),
                            ("capm_unlagged", "gross_unlagged_rebuild", "spy_unlagged_window")):
        p = np.array([x[pkey] for x in r1], float)
        m = np.array([x[skey] for x in r1], float)
        good = ~(np.isnan(p) | np.isnan(m))
        out[lbl] = _ols(p[good], m[good])
    out["records"] = r1
    return out


def _ols(y, x):
    """Univariate OLS with t-stats. Returns alpha in bps, beta, and t(beta != 1)."""
    n = len(y)
    X = np.column_stack([np.ones(n), x])
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    resid = y - X @ beta
    dof = n - 2
    s2 = (resid @ resid) / dof
    cov = s2 * np.linalg.inv(X.T @ X)
    se = np.sqrt(np.diag(cov))
    return {"n": n, "alpha_bps": beta[0] * 1e4, "t_alpha": beta[0] / se[0],
            "beta": beta[1], "se_beta": se[1], "t_beta_ne_1": (beta[1] - 1) / se[1],
            "r2": 1 - (resid @ resid) / ((y - y.mean()) @ (y - y.mean()))}


# --------------------------------------------------------------------------
# Stage 2 -- layer attribution
# --------------------------------------------------------------------------
def stub_row_diagnostic():
    """1D -- why the three 'missing-book' quarters have a return but no book.

    They are NOT quarters whose holdings snapshot went missing. The portfolio
    endpoint's rows for 2014-09-30, 2020-09-30 and 2025-03-31 describe a portfolio
    of ONE or TWO names holding 0.3%-0.5% of the AUM the neighbouring quarters
    report. They are stub filings (a fragment or a one-position amendment) that the
    endpoint has stamped as a full reporting period and computed a
    portfolio_gross_return from.

    That is why get_filer_holdings(as_of=...) never resolves a book with
    report_date == teo for them: there is no full book behind the row, and the
    as_of walk falls back to the prior quarter's ORIGINAL.

    Consequence for the Sharpe bridge: the four rows the rebuild excludes are not
    'unusually strong Berkshire quarters we cannot verify' -- three of them are the
    returns of a 1-2 name stub portfolio, and the fourth is the terminal row's
    open-ended window. Their drop-idio mean of 676 bps is an artifact of that, not
    a property of Berkshire's book. The 1.003 Sharpe should not be quoted.
    """
    rows = B.portfolio_rows(NAME)
    terminal_teo = rows[-1]["teo"]
    stubs, kept = [], []
    for r in rows:
        h = B.holdings_for_teo(NAME, r["teo"])
        drop_idio = (r["portfolio_market_return"] + r["portfolio_sector_return"]
                     + r["portfolio_subsector_return"])
        rec = {"teo": r["teo"], "n_holdings_active": r.get("n_holdings_active"),
               "effective_n": r.get("effective_n"), "total_aum_usd": r.get("total_aum_usd"),
               "gross_bps": r["portfolio_gross_return"] * 1e4, "drop_idio_bps": drop_idio * 1e4,
               "resolved_report_date": h.get("report_date")}
        if h.get("report_date") != r["teo"]:
            stubs.append(rec)
        elif r["teo"] != terminal_teo:
            kept.append(rec)
    med_aum = float(np.median([k["total_aum_usd"] for k in kept if k["total_aum_usd"]]))
    for s in stubs:
        s["aum_vs_median_kept"] = (s["total_aum_usd"] / med_aum) if s["total_aum_usd"] else None
    return {
        "stub_rows": stubs, "n_kept": len(kept),
        "median_aum_kept": med_aum,
        "kept_drop_idio_mean_bps": float(np.mean([k["drop_idio_bps"] for k in kept])),
        "stub_drop_idio_mean_bps": float(np.mean([s["drop_idio_bps"] for s in stubs])),
        "verdict": ("Not recoverable and not worth recovering: the rows do not describe "
                    "the filer's book. Exclude permanently."),
    }


def stage2_validate_ex_terminal():
    """B.stage2_validate over every buildable teo EXCEPT the terminal row, whose
    endpoint layer returns are measured over the wrong window (see terminal_row_evidence)."""
    rows = B.portfolio_rows(NAME)
    terminal_teo = rows[-1]["teo"]
    teos = [pd.Timestamp(r["teo"]) for r in rows]
    diffs = {k: [] for k in EP_COLS}
    tmax = B.trading_days().max()
    for i, r in enumerate(rows):
        if r["teo"] == terminal_teo:
            continue
        h = B.holdings_for_teo(NAME, r["teo"])
        if h.get("report_date") != r["teo"]:
            continue
        end = B.fwd_quarter_end(teos[i])
        if end > tmax:
            continue
        lay = B.portfolio_window_layers(h["holdings"], teos[i], end)
        for k in diffs:
            ep = r.get(EP_COLS[k])
            if ep is not None and not np.isnan(lay[k]):
                diffs[k].append(abs(lay[k] - ep) * 1e4)
    return {k: {"n": len(v), "mean_bps": float(np.mean(v)), "median_bps": float(np.median(v))}
            for k, v in diffs.items() if v}


def reconcile_teos():
    """1D -- full teo reconciliation. Names every gap between the two filer endpoints."""
    fid = B.FILERS[NAME]
    p = _HERE / "cache" / f"portfolio_{fid}.json"
    raw = json.loads(p.read_text())
    tmax = B.trading_days().max()

    all_rows = sorted(raw, key=lambda r: r["teo"])
    with_gross = [r for r in all_rows if r.get("portfolio_gross_return") is not None]
    terminal_teo = with_gross[-1]["teo"]

    book_ok, book_missing = [], []
    for r in with_gross:
        h = B.holdings_for_teo(NAME, r["teo"])
        (book_ok if h.get("report_date") == r["teo"] else book_missing).append(r["teo"])

    # calendar gaps: quarter-ends absent from the teo series entirely
    teos = pd.to_datetime([r["teo"] for r in all_rows])
    span = pd.date_range(teos.min(), teos.max(), freq="QE")
    calendar_gaps = [str(d.date()) for d in span if d not in set(teos)]

    no_fwd_window = [t for t in book_ok
                     if B.fwd_quarter_end(t) > tmax]

    return {
        "rows_returned_by_endpoint": len(all_rows),
        "rows_carrying_gross_return": len(with_gross),
        "rows_without_gross_return": [r["teo"] for r in all_rows
                                      if r.get("portfolio_gross_return") is None],
        "teo_span": [str(teos.min().date()), str(teos.max().date())],
        "calendar_quarter_ends_absent_from_series": calendar_gaps,
        "rows_with_matching_holdings_book": len(book_ok),
        "rows_with_NO_holdings_book": book_missing,
        "terminal_row_excluded": terminal_teo,
        "rows_with_no_forward_window_yet": no_fwd_window,
        "usable_for_stage0": len(book_ok) - 1,
        "usable_for_stage1_windows": len(book_ok) - 1,
    }


def stage2_audit():
    val = B.stage2_validate(NAME)
    val_ex = stage2_validate_ex_terminal()
    r2 = B.stage2(NAME)

    # q_len-normalised per-quarter contributions, matching the published convention
    def norm(recs, key):
        return [x[key] / x["q_len"] for x in recs
                if x[key] is not None and not np.isnan(x[key])]

    lagged = {}
    for k, col in (("market", "market"), ("sector", "sector"),
                   ("subsector", "subsector"), ("idio", "idio"), ("gross", "gross")):
        lagged[k] = B.stats(norm(r2, col))
    lagged["sector_plus_subsector"] = B.stats(
        [(x["sector"] + x["subsector"]) / x["q_len"] for x in r2
         if x["sector"] is not None and not np.isnan(x["sector"])])
    lagged["drop_idio"] = B.stats(
        [(x["market"] + x["sector"] + x["subsector"]) / x["q_len"] for x in r2
         if x["market"] is not None and not np.isnan(x["market"])])

    # unlagged twin, same books, same q_len convention
    rows = B.portfolio_rows(NAME)
    teos = [pd.Timestamp(r["teo"]) for r in rows]
    valid = B._valid_book_indices(NAME, rows, teos)
    tmax = B.trading_days().max()
    unl_recs = []
    for k in range(len(valid) - 1):
        i, j = valid[k], valid[k + 1]
        t_in, t_out = teos[i], teos[j]
        if t_out > tmax:
            continue
        h = B.holdings_for_teo(NAME, rows[i]["teo"])
        lay = B.portfolio_window_layers(h["holdings"], t_in, t_out)
        qlen = (t_out - t_in).days / 91.3125
        unl_recs.append({"teo": rows[i]["teo"], "q_len": qlen, **lay})
    unlagged = {}
    for k in ("market", "sector", "subsector", "idiosyncratic"):
        unlagged[k] = B.stats([x[k] / x["q_len"] for x in unl_recs if not np.isnan(x[k])])
    unlagged["sector_plus_subsector"] = B.stats(
        [(x["sector"] + x["subsector"]) / x["q_len"] for x in unl_recs if not np.isnan(x["sector"])])
    unlagged["drop_idio"] = B.stats(
        [(x["market"] + x["sector"] + x["subsector"]) / x["q_len"] for x in unl_recs
         if not np.isnan(x["market"])])

    # SECOND unlagged construction: fixed teo -> teo+3mo forward quarter. This is the
    # endpoint's own window definition, so it -- not the lag twin above -- is what
    # step C of the Sharpe bridge must use to be comparable with step B.
    fwd_recs = []
    for i, r in enumerate(rows):
        h = B.holdings_for_teo(NAME, r["teo"])
        if h.get("report_date") != r["teo"] or r["teo"] == rows[-1]["teo"]:
            continue
        end = B.fwd_quarter_end(teos[i])
        if end > tmax:
            continue
        lay = B.portfolio_window_layers(h["holdings"], teos[i], end)
        if np.isnan(lay["market"]):
            continue
        fwd_recs.append({"teo": r["teo"], **lay})
    unlagged_fwdq = {}
    for k in ("market", "sector", "subsector", "idiosyncratic"):
        unlagged_fwdq[k] = B.stats([x[k] for x in fwd_recs])
    unlagged_fwdq["sector_plus_subsector"] = B.stats(
        [x["sector"] + x["subsector"] for x in fwd_recs])
    unlagged_fwdq["drop_idio"] = B.stats(
        [x["market"] + x["sector"] + x["subsector"] for x in fwd_recs])

    return {"validation": val, "validation_ex_terminal": val_ex,
            "lagged": lagged, "unlagged": unlagged, "unlagged_fwdq": unlagged_fwdq,
            "records": r2, "fwdq_records": fwd_recs}


# --------------------------------------------------------------------------
# 1B -- endpoint vs rebuild sector/subsector Sharpe, with and without terminal row
# --------------------------------------------------------------------------
def sector_subsector_audit(stage2):
    """The published contradiction: the endpoint says sector 0.28 / subsector 0.49,
    the rebuild says the opposite. Test whether SAMPLE (which teos are included)
    explains it, exactly as the Sharpe bridge did."""
    rows = B.portfolio_rows(NAME)
    terminal_teo = rows[-1]["teo"]
    rebuild_teos = {x["teo"] for x in stage2["records"]}

    def ep_stats(subset_teos, label):
        out = {"label": label, "teos": len(subset_teos)}
        for k, col in EP_COLS.items():
            vals = [r[col] for r in rows if r["teo"] in subset_teos and r.get(col) is not None]
            out[k] = B.stats(vals)
        vals = [r[EP_COLS["sector"]] + r[EP_COLS["subsector"]] for r in rows
                if r["teo"] in subset_teos and r.get(EP_COLS["sector"]) is not None]
        out["sector_plus_subsector"] = B.stats(vals)
        vals = [r[EP_COLS["market"]] + r[EP_COLS["sector"]] + r[EP_COLS["subsector"]]
                for r in rows if r["teo"] in subset_teos and r.get(EP_COLS["market"]) is not None]
        out["drop_idio"] = B.stats(vals)
        return out

    all_teos = {r["teo"] for r in rows}
    return {
        "endpoint_all_46": ep_stats(all_teos, "endpoint, all 46 teos (published)"),
        "endpoint_ex_terminal": ep_stats(all_teos - {terminal_teo}, "endpoint, terminal row dropped"),
        "endpoint_rebuildable": ep_stats(rebuild_teos, "endpoint, restricted to rebuildable teos"),
        "rebuild_unlagged": {k: stage2["unlagged"][k] for k in
                             ("market", "sector", "subsector", "idiosyncratic",
                              "sector_plus_subsector", "drop_idio")},
    }


# --------------------------------------------------------------------------
# Sharpe bridge
# --------------------------------------------------------------------------
def sharpe_bridge(stage2, secsub):
    """Steps A->B->C must all use the SAME window definition to be a bridge at all.

    A and B are endpoint rows, whose returns are fixed forward quarters, so C uses the
    rebuild on fixed forward quarters (`unlagged_fwdq`), NOT the lag twin. The lag twin
    is reported separately as C2 because it is the right comparison for step D only.
    """
    return {
        "A_endpoint_all46": secsub["endpoint_all_46"]["drop_idio"]["sharpe"],
        "A2_endpoint_ex_terminal": secsub["endpoint_ex_terminal"]["drop_idio"]["sharpe"],
        "B_endpoint_rebuildable": secsub["endpoint_rebuildable"]["drop_idio"]["sharpe"],
        "C_rebuild_unlagged": stage2["unlagged_fwdq"]["drop_idio"]["sharpe"],
        "C2_rebuild_unlagged_lagtwin": stage2["unlagged"]["drop_idio"]["sharpe"],
        "D_rebuild_lagged": stage2["lagged"]["drop_idio"]["sharpe"],
    }


# --------------------------------------------------------------------------
def main():
    print("=" * 78)
    print("BERKSHIRE RE-AUDIT -- fixed code (NaN fix + terminal-row exclusion)")
    print("=" * 78)

    term = terminal_row_evidence()
    print("\n[1] TERMINAL-ROW DEFECT in get_filer_portfolio (new finding)")
    print("    Row's portfolio_market_return vs SPY over the row's own forward quarter.")
    print(f"    {'filer':<11} {'terminal':<12} {'dev bps':>9} {'prior med':>10} {'ratio':>7} {'implied Q':>10}")
    for k, v in term.items():
        print(f"    {k:<11} {v['terminal_teo']:<12} {v['terminal_dev_bps']:>+9.0f} "
              f"{v['prior_median_abs_dev_bps']:>10.0f} {v['dev_vs_prior_median_x']:>6.1f}x "
              f"{v['implied_horizon_quarters']:>9.1f}")

    s0 = stage0_audit()
    print(f"\n[2] STAGE 0 validation gate  (terminal row = {s0['terminal_teo']})")
    for key in ("with_terminal", "without_terminal"):
        v = s0[key]
        print(f"    {v['label']:<40} n={v['n']:<3} mean={v['mean_bps']:6.1f} "
              f"median={v['median_bps']:5.1f} max={v['max_bps']:7.1f}  -> {v['verdict']}")
    print(f"    missing-book quarters: {s0['missing_book_teos']}")

    s1 = stage1_audit()
    print(f"\n[3] STAGE 1 lagged gross   n={s1['n_windows']} windows "
          f"({s1['n_multi_quarter']} span >1Q), {s1['first_entry']} -> {s1['last_exit']}")
    print(f"    {'series':<20} {'mean bps':>9} {'t':>6} {'hit%':>6} {'Sharpe':>7} {'ann%':>7} {'cum%':>8}")
    for lbl in ("lagged", "unlagged_rebuild", "unlagged_endpoint", "spy_lagged", "spy_unlagged"):
        s = s1[lbl]
        print(f"    {lbl:<20} {s['mean_bps']:>9.1f} {s['t']:>6.2f} {s['hit']:>6.0f} "
              f"{s['sharpe']:>7.2f} {s['ann_pct']:>7.2f} {s['cum_pct']:>8.1f}")
    print(f"    survival: {s1['survival_pct']:.0f}% of unlagged gross mean")
    for lbl in ("capm_lagged", "capm_unlagged"):
        c = s1[lbl]
        print(f"    {lbl:<20} alpha={c['alpha_bps']:+7.1f}bps t={c['t_alpha']:+5.2f} "
              f"beta={c['beta']:.2f} t(b!=1)={c['t_beta_ne_1']:+5.2f} R2={c['r2']:.2f}")

    s2 = stage2_audit()
    print("\n[4] STAGE 2 validation (rebuild vs endpoint UNLAGGED layer returns)")
    print(f"    {'layer':<15} {'incl. terminal row':>28} | {'terminal row dropped':>28}")
    for k in EP_COLS:
        d, e = s2["validation"].get(k), s2["validation_ex_terminal"].get(k)
        if not d:
            continue
        bar = "PASS" if e["median_bps"] < 50 else "FAIL"
        print(f"    {k:<15} mean={d['mean_bps']:6.1f} med={d['median_bps']:5.1f} (n={d['n']:>2}) | "
              f"mean={e['mean_bps']:6.1f} med={e['median_bps']:5.1f} (n={e['n']:>2})  {bar}")
    print("\n    Layer attribution, q_len-normalised:")
    print(f"    {'layer':<22} {'LAG mean':>9} {'t':>6} {'Sharpe':>7} | {'UNL mean':>9} {'t':>6} {'Sharpe':>7}")
    pairs = [("market", "market"), ("sector", "sector"), ("subsector", "subsector"),
             ("sector_plus_subsector", "sector_plus_subsector"),
             ("drop_idio", "drop_idio"), ("idio", "idiosyncratic"), ("gross", None)]
    for lk, uk in pairs:
        L = s2["lagged"].get(lk, {})
        U = s2["unlagged"].get(uk, {}) if uk else {}
        if not L:
            continue
        us = (f"{U['mean_bps']:>9.1f} {U['t']:>6.2f} {U['sharpe']:>7.2f}"
              if U else f"{'-':>9} {'-':>6} {'-':>7}")
        print(f"    {lk:<22} {L['mean_bps']:>9.1f} {L['t']:>6.2f} {L['sharpe']:>7.2f} | {us}")

    ss = sector_subsector_audit(s2)
    print("\n[5] 1B -- sector vs subsector Sharpe contradiction")
    print(f"    {'source':<45} {'sector':>8} {'subsec':>8} {'sec+sub':>8}")
    for key in ("endpoint_all_46", "endpoint_ex_terminal", "endpoint_rebuildable"):
        v = ss[key]
        print(f"    {v['label']:<45} {v['sector']['sharpe']:>8.2f} "
              f"{v['subsector']['sharpe']:>8.2f} {v['sector_plus_subsector']['sharpe']:>8.2f}")
    rb = ss["rebuild_unlagged"]
    print(f"    {'daily rebuild, unlagged LAG-TWIN windows':<45} {rb['sector']['sharpe']:>8.2f} "
          f"{rb['subsector']['sharpe']:>8.2f} {rb['sector_plus_subsector']['sharpe']:>8.2f}")
    fq = s2["unlagged_fwdq"]
    print(f"    {'daily rebuild, unlagged FWD-QUARTER windows':<45} {fq['sector']['sharpe']:>8.2f} "
          f"{fq['subsector']['sharpe']:>8.2f} {fq['sector_plus_subsector']['sharpe']:>8.2f}")
    print("    ^ the last two rows are the like-for-like comparison with the endpoint row above")

    br = sharpe_bridge(s2, ss)
    print("\n[6] Sharpe bridge -- drop-idio (market+sector+subsector)")
    for k, v in br.items():
        print(f"    {k:<28} {v:.3f}" if v is not None else f"    {k:<28} n/a")

    rec = reconcile_teos()
    print("\n[7] 1D -- teo reconciliation (get_filer_portfolio vs get_filer_holdings)")
    print(f"    rows returned by get_filer_portfolio       {rec['rows_returned_by_endpoint']}")
    print(f"    ... carrying a portfolio_gross_return      {rec['rows_carrying_gross_return']}")
    print(f"    ... with a matching holdings book          {rec['rows_with_matching_holdings_book']}")
    print(f"    teo span                                   {rec['teo_span'][0]} -> {rec['teo_span'][1]}")
    print(f"    quarter-ends ABSENT from the teo series    {rec['calendar_quarter_ends_absent_from_series']}")
    print(f"    rows with NO holdings book                 {rec['rows_with_NO_holdings_book']}")
    print(f"    terminal row (open-ended return, dropped)  {rec['terminal_row_excluded']}")
    print(f"    => usable Stage 0 comparisons              {rec['usable_for_stage0']}")

    stub = stub_row_diagnostic()
    print("\n[8] 1D -- the three 'missing-book' quarters are STUB ROWS, not missing books")
    print(f"    {'teo':<12} {'n_active':>9} {'AUM $':>16} {'vs median':>10} {'gross':>9} {'drop-idio':>10}")
    for s in stub["stub_rows"]:
        print(f"    {s['teo']:<12} {str(s['n_holdings_active']):>9} {s['total_aum_usd']:>16,.0f} "
              f"{s['aum_vs_median_kept']:>9.3%} {s['gross_bps']:>+9.0f} {s['drop_idio_bps']:>+10.0f}")
    print(f"    median AUM of the {stub['n_kept']} kept quarters: ${stub['median_aum_kept']:,.0f}")
    print(f"    drop-idio mean: stub rows {stub['stub_drop_idio_mean_bps']:.0f} bps "
          f"vs kept {stub['kept_drop_idio_mean_bps']:.0f} bps")
    print(f"    verdict: {stub['verdict']}")

    out = {"terminal_row": term, "stage0": s0, "stage1": s1, "stage2": s2,
           "sector_subsector": ss, "sharpe_bridge": br, "reconciliation": rec,
           "stub_rows": stub}
    (_HERE / "cache" / "reaudit_berkshire.json").write_text(json.dumps(out, default=str, indent=1))
    print(f"\nwrote cache/reaudit_berkshire.json   [cache hits={B._hits['hit']} misses={B._hits['miss']}]")
    return out


if __name__ == "__main__":
    main()
