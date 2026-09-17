"""Extend the D. E. Shaw returns+decomp cache back to the returns floor (2013-07) so the
report-date window study covers the full studiable history (49 books, 2013-09-30..2026-03-31).

Reads cache/deshaw_hist_plan.json (top-92%-weight union of names NOT yet cached), fetches
get_ticker_returns + get_returns_decomposition per name (both cache to cache/). Fully resumable:
already-cached names are skipped instantly, so a kill loses nothing. Logs progress to
cache/deshaw_hist_fetch.log.
"""
import riskmodels, sys, json, time, warnings
from pathlib import Path
warnings.filterwarnings("ignore")
_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
import build_lagged as B

LOG = B._CACHE / "deshaw_hist_fetch.log"
def log(m):
    with open(LOG, "a") as f:
        f.write(f"[{__import__('datetime').datetime.now()}] {m}\n")
    print(m, flush=True)

plan = json.load(open(B._CACHE / "deshaw_hist_plan.json"))
names = plan["missing_names"]
log(f"=== history extension fetch: {len(names)} names (returns+decomp) ===")
t0 = time.time()
ok = err = 0
for i, tk in enumerate(names):
    r = B.returns_series(tk)   # caches
    d = B.decomp_series(tk)    # caches
    if r is None and d is None:
        err += 1
    else:
        ok += 1
    if (i + 1) % 25 == 0:
        el = time.time() - t0
        log(f"  {i+1}/{len(names)} | ok={ok} err={err} | {el:.0f}s | ~{el/(i+1):.1f}s/name")
log(f"=== DONE: {ok} ok, {err} err, {time.time()-t0:.0f}s ===")
