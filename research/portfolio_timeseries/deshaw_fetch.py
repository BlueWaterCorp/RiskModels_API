"""Task 0 — D.E.Shaw data prefetch (long pole). Runs unattended, caches everything, resumable.

D.E.Shaw is huge (~2382 names, 1000-row API cap, diffuse weights, high turnover). Full-history
name-level rebuild is infeasible in the time/cost budget, so:
  - holdings: last N_QTRS quarters, as_of+limit=1000 (99% weight where n_total<=1000)
  - returns + decomposition: fetched for the top-K tickers by CUMULATIVE weight across those
    vintages (maximises per-call coverage), capped at K_CAP to fit ~2h.
Coverage per vintage is reported so Stage 0 can judge whether the gate can pass.
"""
import riskmodels  # FIRST
import sys, warnings, time, json
from pathlib import Path
warnings.filterwarnings("ignore")
sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np, pandas as pd
import build_lagged as B

NAME = "DEShaw"
N_QTRS = 20          # last ~5 years
K_CAP = 900          # max unique tickers to fetch returns+decomp for
LOG = Path(__file__).parent / "cache" / "deshaw_fetch_progress.log"

def log(msg):
    line = f"[{pd.Timestamp('now')}] {msg}"
    with open(LOG, "a") as f:
        f.write(line + "\n")
    print(line, flush=True)

log(f"=== D.E.Shaw prefetch start: last {N_QTRS}q, cap {K_CAP} tickers ===")
rows = B.portfolio_rows(NAME)
teos = [r["teo"] for r in rows]
recent = teos[-N_QTRS:]
log(f"portfolio: {len(teos)} teos total, using last {len(recent)}: {recent[0]}..{recent[-1]}")

# 1. holdings per vintage (cached via holdings_for_teo, limit=1000)
weight_priority = {}   # ticker -> summed weight across vintages
cov_report = []
for t in recent:
    h = B.holdings_for_teo(NAME, t)
    if h.get("report_date") != t:
        log(f"  {t}: report_date={h.get('report_date')} (book missing/mismatch) — skip")
        continue
    hold = [(x["ticker"], x["weight"]) for x in h["holdings"] if x.get("ticker") and x.get("weight")]
    for tk, w in hold:
        weight_priority[tk] = weight_priority.get(tk, 0.0) + w
    cov_report.append((t, len(hold), h.get("n_total_holdings")))
log(f"holdings done: {len(cov_report)} valid vintages, {len(weight_priority)} unique tickers")

# 2. prioritise tickers, cap at K_CAP
ranked = sorted(weight_priority.items(), key=lambda z: -z[1])
chosen = [tk for tk, _ in ranked[:K_CAP]]
log(f"fetching returns+decomp for top {len(chosen)} of {len(ranked)} tickers (by cumulative weight)")

# 3. fetch returns + decomp (both cached), log every 50
t0 = time.time()
for i, tk in enumerate(chosen + ["SPY"], 1):
    B.returns_series(tk)
    B.decomp_series(tk)
    if i % 50 == 0:
        el = time.time() - t0
        log(f"  {i}/{len(chosen)+1} tickers | {el:.0f}s elapsed | ~{el/i:.1f}s/ticker")
log(f"returns+decomp done: {len(chosen)+1} tickers in {time.time()-t0:.0f}s")

# 4. coverage per vintage among fetched tickers (does Stage 0 have a chance?)
chosen_set = set(chosen)
covs = []
for t in recent:
    h = B.holdings_for_teo(NAME, t)
    if h.get("report_date") != t:
        continue
    tot = sum(x["weight"] for x in h["holdings"] if x.get("ticker") and x.get("weight"))
    cov = sum(x["weight"] for x in h["holdings"] if x.get("ticker") in chosen_set and x.get("weight"))
    covs.append(cov / tot if tot else 0)
log(f"weight coverage among fetched tickers: median={np.median(covs):.1%} min={np.min(covs):.1%} max={np.max(covs):.1%}")
json.dump({"n_qtrs": len(cov_report), "n_tickers_fetched": len(chosen), "n_unique": len(ranked),
           "coverage_median": float(np.median(covs)), "coverage_min": float(np.min(covs)),
           "recent_teos": recent},
          open(Path(__file__).parent / "cache" / "deshaw_fetch_meta.json", "w"), default=str)
log("=== D.E.Shaw prefetch DONE ===")
