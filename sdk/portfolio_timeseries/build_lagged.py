"""Lagged 13F backtest pipeline — daily name-level rebuild.

Stages (gated; see the module docstring in LAGGED_RESULTS.md):
  0  validate the daily buy-and-hold rebuild against the endpoint's gross return
  1  lagged gross series (enter teo+45d rolled to next trading day, hold to next entry)
  2  layer decomposition of the lagged series (needs per-name l3 ER shares, cached w/ holdings)
  3  extend to Pershing / Appaloosa / Greenlight

Everything caches to cache/ keyed by (filer, vintage) / ticker so a timeout never loses work.
Re-run resumes from cache. Run in background:  python -m ... build_lagged all
"""
from __future__ import annotations
import riskmodels  # import-order shim: real 0.3.11 before sdk/ on path
import sys, json, warnings
from pathlib import Path
_SDK = str(Path(__file__).resolve().parents[1])
if _SDK not in sys.path:
    sys.path.insert(0, _SDK)
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")  # silence ValidationWarning / pandas bottleneck noise

_HERE = Path(__file__).parent
_CACHE = _HERE / "cache"
_CACHE.mkdir(exist_ok=True)

FILERS = {
    "Berkshire": "BW-FILER-CIK0001067983",
    "Pershing": "BW-FILER-CIK0001336528",
    "Appaloosa": "BW-FILER-CIK0001656456",
    "Greenlight": "BW-FILER-CIK0001079114",
    "DEShaw": "BW-FILER-CIK0001009207",
}
# get_filer_holdings caps at 1000 rows/call; ask for the max (Berkshire has ~25, D.E.Shaw ~2382).
_HOLDINGS_LIMIT = 1000
LAYER_COLS = {
    "market": "portfolio_market_return", "sector": "portfolio_sector_return",
    "subsector": "portfolio_subsector_return", "idiosyncratic": "portfolio_idiosyncratic_return",
}

_client = None
_hits = {"hit": 0, "miss": 0}
# When True, returns_series/decomp_series never hit the API for uncached tickers (return None).
# Used during D.E.Shaw analysis so a partially-fetched universe doesn't trigger live fetches.
CACHE_ONLY = False


def client():
    global _client
    if _client is None:
        _client = riskmodels.RiskModelsClient.from_env()
    return _client


def _read(path):
    if path.exists():
        _hits["hit"] += 1
        return json.loads(path.read_text())
    _hits["miss"] += 1
    return None


def _write(path, obj):
    path.write_text(json.dumps(obj, default=str))


# ---- endpoint portfolio rows (gross + layer returns per teo) ----
def portfolio_rows(name):
    fid = FILERS[name]
    p = _CACHE / f"portfolio_{fid}.json"
    cached = _read(p)
    if cached is None:
        cached = client().get_filer_portfolio(fid)["rows"]
        _write(p, cached)
    rows = [r for r in cached if r.get("portfolio_gross_return") is not None]
    rows.sort(key=lambda r: r["teo"])
    return rows


# ---- holdings reported FOR teo_T, cached ----
# get_filer_holdings(as_of=X) returns the latest book with filing_date <= X. To get the book
# whose report_date == teo, as_of must be >= that book's true filing date. A tight teo+55d
# buffer returns the PRIOR book when the filing was late (verified: 2014/2020/2025 quarters).
# We escalate the buffer until report_date == teo, capping below the NEXT book's filing
# (~teo+136d) so we never overshoot into the following quarter.
def holdings_for_teo(name, teo):
    fid = FILERS[name]
    p = _CACHE / f"holdings_{fid}_{teo}.json"
    cached = _read(p)
    if cached is not None and cached.get("report_date") == teo:
        return cached  # only trust cache if it holds the correct book
    last = None
    for buf in (55, 90, 120):
        as_of = (pd.Timestamp(teo) + pd.Timedelta(days=buf)).strftime("%Y-%m-%d")
        try:
            h = client().get_filer_holdings(fid, as_of=as_of, limit=_HOLDINGS_LIMIT)
        except Exception as e:
            last = {"error": f"{type(e).__name__}: {e}", "report_date": None, "holdings": []}
            continue
        rec = {"report_date": h.get("report_date"), "filing_date": h.get("filing_date"),
               "as_of_requested": as_of, "amendment_type": h.get("amendment_type"),
               "filing_type": h.get("filing_type"), "accession_number": h.get("accession_number"),
               "n_total_holdings": h.get("n_total_holdings"), "n_holdings_returned": h.get("n_holdings_returned"),
               "holdings": [{"ticker": x.get("ticker"), "security_id": x.get("security_id"),
                             "weight": x.get("weight"),
                             "l3_market_er": x.get("l3_market_er"), "l3_sector_er": x.get("l3_sector_er"),
                             "l3_subsector_er": x.get("l3_subsector_er"), "l3_residual_er": x.get("l3_residual_er")}
                            for x in h["holdings"]]}
        last = rec
        if rec["report_date"] == teo:
            break
    _write(p, last)
    return last


# ---- daily gross returns per ticker (full 13y), cached ----
def returns_series(ticker):
    p = _CACHE / f"returns_{ticker.replace('/', '_')}.json"
    cached = _read(p)
    if cached is None:
        if CACHE_ONLY:
            return None
        try:
            df = client().get_ticker_returns(ticker, years=13)
            cached = {"date": [str(d) for d in df["date"].values],
                      "r": [float(x) for x in df["returns_gross"].values]}
        except Exception as e:
            cached = {"error": f"{type(e).__name__}: {e}"}
        _write(p, cached)
    if "error" in cached:
        return None
    s = pd.Series(cached["r"], index=pd.to_datetime(cached["date"]))
    return s[~s.index.duplicated(keep="last")].sort_index()


_ret_cache = {}
def _ret(ticker):
    if ticker not in _ret_cache:
        _ret_cache[ticker] = returns_series(ticker)
    return _ret_cache[ticker]


# ---- per-day per-name ADDITIVE factor decomposition (get_returns_decomposition) ----
# Columns map to the four orthogonal ERM3 layers; they sum to gross_return daily to ~5e-10:
#   market    = l1_factor_return
#   sector    = l2_factor_return   (incremental, net of market)
#   subsector = l3_factor_return   (incremental, net of sector)
#   idio      = l3_residual_return
_LAYER_MAP = {"market": "l1_factor_return", "sector": "l2_factor_return",
              "subsector": "l3_factor_return", "idiosyncratic": "l3_residual_return"}


def decomp_series(ticker):
    p = _CACHE / f"decomp_{ticker.replace('/', '_')}.json"
    cached = _read(p)
    if cached is None:
        if CACHE_ONLY:
            return None
        try:
            df = client().get_returns_decomposition(ticker, years=15)
            cached = {"date": [str(d) for d in df["date"].values]}
            for k, col in _LAYER_MAP.items():
                cached[k] = [float(x) for x in df[col].values]
        except Exception as e:
            cached = {"error": f"{type(e).__name__}: {e}"}
        _write(p, cached)
    if "error" in cached:
        return None
    idx = pd.to_datetime(cached["date"])
    out = {}
    for k in _LAYER_MAP:
        s = pd.Series(cached[k], index=idx)
        out[k] = s[~s.index.duplicated(keep="last")].sort_index()
    return out


_decomp_cache = {}
def _decomp(ticker):
    if ticker not in _decomp_cache:
        _decomp_cache[ticker] = decomp_series(ticker)
    return _decomp_cache[ticker]


def name_layer_windows(ticker, start, end):
    """Compounded per-layer return of one name over (start, end]. Each layer compounded as
    its own daily stream (product of 1+layer_daily) — matches the endpoint's per-quarter layer
    returns, which carry the same small geometric-linking residual vs gross. None if no data."""
    d = _decomp(ticker)
    if d is None:
        return None
    out = {}
    for k, s in d.items():
        w = s[(s.index > start) & (s.index <= end)]
        v = w.values[~np.isnan(w.values)]           # drop nan days (decomp data-quality gaps)
        if len(v) == 0:
            return None
        out[k] = float(np.prod(1 + v) - 1)
    return out


def portfolio_window_layers(holdings, start, end):
    """Portfolio layer returns over a window = Σ w_i · (name's compounded layer return),
    renormalised to covered names. Uses the additive get_returns_decomposition series."""
    layers = {"market": 0.0, "sector": 0.0, "subsector": 0.0, "idiosyncratic": 0.0}
    covered = 0.0
    for x in holdings:
        tk = x.get("ticker"); w = x.get("weight") or 0.0
        if not tk:
            continue
        nl = name_layer_windows(tk, start, end)
        if nl is None:
            continue
        for k in layers:
            layers[k] += w * nl[k]
        covered += w
    if covered <= 0:
        return {k: float("nan") for k in layers}
    return {k: v / covered for k, v in layers.items()}


def window_return(ticker, start, end):
    """Buy-and-hold total return of one name over (start, end]. None if no data.

    Drops NaN return days before compounding — same data-quality gaps that bite the decomp
    path (name_layer_windows). Without this, a single name with one NaN day returns NaN, which
    still counts toward `covered` in portfolio_window_return but poisons the whole portfolio sum
    (one 3bps freshly-IPO'd name nulled entire early D.E.Shaw quarters). If every day in the
    window is NaN the name has no usable data -> None (skipped, not treated as 0)."""
    s = _ret(ticker)
    if s is None:
        return None
    w = s[(s.index > start) & (s.index <= end)]
    v = w.values[~np.isnan(w.values)]
    if len(v) == 0:
        return None
    return float(np.prod(1 + v) - 1)


def portfolio_window_return(holdings, start, end):
    """Buy-and-hold gross = Σ w_i R_i, renormalised to covered names.
    Returns (gross_renorm, gross_asis, covered_weight, n_names, missing)."""
    recon = 0.0
    covered = 0.0
    n = 0
    missing = []
    for x in holdings:
        tk = x.get("ticker")
        w = x.get("weight") or 0.0
        if not tk:
            missing.append(("<restricted>", round(w, 4)))
            continue
        R = window_return(tk, start, end)
        if R is None or np.isnan(R):   # guard: a NaN R would poison recon while counting toward covered
            missing.append((tk, round(w, 4)))
            continue
        recon += w * R
        covered += w
        n += 1
    renorm = recon / covered if covered > 0 else float("nan")
    return renorm, recon, covered, n, missing


# ---- trading-day calendar from SPY; +45d entry rule ----
_tdays = None
def trading_days():
    global _tdays
    if _tdays is None:
        s = _ret("SPY")
        _tdays = pd.DatetimeIndex(sorted(set(s.index)))
    return _tdays


def entry_date(teo):
    """teo + 45 calendar days rolled forward to the next available trading day."""
    raw = pd.Timestamp(teo) + pd.Timedelta(days=45)
    td = trading_days()
    nxt = td[td >= raw]
    return nxt[0] if len(nxt) else pd.NaT


def fwd_quarter_end(teo):
    """The endpoint's forward window ends one CALENDAR quarter later, not at the next
    teo in the series — the teo sequence has gaps (2015-06-30, 2021-06-30, 2023-09/12-30
    missing), and using the next available teo doubles the window for those quarters."""
    return pd.Timestamp(teo) + pd.DateOffset(months=3)


def spy_window(start, end):
    return window_return("SPY", start, end)


def stats(x):
    x = np.asarray([v for v in x if v is not None and not (isinstance(v, float) and np.isnan(v))])
    if len(x) == 0:
        return {}
    m, sd = x.mean(), x.std(ddof=1)
    t = m / (sd / np.sqrt(len(x))) if sd > 0 else float("nan")
    cum = float(np.prod(1 + x) - 1)
    yrs = len(x) / 4.0
    return {"n": len(x), "mean_bps": m * 1e4, "std_bps": sd * 1e4, "t": t,
            "hit": float((x > 0).mean() * 100),
            "sharpe": (m / sd) * np.sqrt(4) if sd > 0 else float("nan"),
            "ann_pct": ((1 + cum) ** (1 / yrs) - 1) * 100 if yrs > 0 else float("nan"),
            "cum_pct": cum * 100}


# ---- the validation gate, as a function so the thresholds are explicit ----
# Pre-registered before any lagged analysis was run, so a marginal result could not
# retro-fit the bar. Applied to mean |rebuild - endpoint| in bps over the comparison
# windows. The MEAN is the gate, not the median: the median hides exactly the tail
# quarters where a rebuild diverges most.
GATE_CLEAN_BPS = 25.0
GATE_STOP_BPS = 75.0


def gate_verdict(mean_abs_diff_bps):
    """'CLEAN' (<25) | 'PROCEED_WITH_FLAG' (25-75) | 'STOP' (>75).

    STOP means the downstream numbers are not published, in any form. This is not
    advisory: D. E. Shaw's lagged rebuild failed here at 78 bps and no lagged
    D. E. Shaw survival / Sharpe / CAPM figure was ever published as a result.
    """
    if mean_abs_diff_bps < GATE_CLEAN_BPS:
        return "CLEAN"
    if mean_abs_diff_bps <= GATE_STOP_BPS:
        return "PROCEED_WITH_FLAG"
    return "STOP"


# ============================ STAGE 0 ============================
def stage0(name="Berkshire"):
    rows = portfolio_rows(name)
    teos = [pd.Timestamp(r["teo"]) for r in rows]
    recs = []
    # prefetch all holdings + union of tickers first (so returns cache is warm)
    all_h = []
    for i, r in enumerate(rows):
        h = holdings_for_teo(name, r["teo"])
        all_h.append(h)
    tickers = sorted({x["ticker"] for h in all_h for x in h["holdings"] if x.get("ticker")} | {"SPY"})
    for tk in tickers:
        _ret(tk)  # warm cache
    for i, r in enumerate(rows):
        teo_T = teos[i]
        end = fwd_quarter_end(teo_T)                     # fixed 1-quarter forward window
        if end > trading_days().max():
            continue                                     # no forward returns yet
        h = all_h[i]
        book_ok = h.get("report_date") == r["teo"]       # False => holdings snapshot missing
        renorm, asis, cov, n, missing = portfolio_window_return(h["holdings"], teo_T, end)
        target = r["portfolio_gross_return"]
        recs.append({"teo": r["teo"], "window_end": str(end.date()),
                     "report_date": h.get("report_date"), "book_ok": book_ok,
                     "endpoint_gross": target, "rebuild_renorm": renorm, "rebuild_asis": asis,
                     "covered_w": cov, "n_names": n, "missing": missing,
                     "diff_renorm_bps": abs(renorm - target) * 1e4 if not np.isnan(renorm) else None,
                     "diff_asis_bps": abs(asis - target) * 1e4 if not np.isnan(asis) else None})
    _write(_CACHE / f"stage0_{name}.json", recs)
    return recs


# ============================ STAGE 1 ============================
def _valid_book_indices(name, rows, teos):
    """Indices whose holdings snapshot actually has report_date == teo (buildable)."""
    ok = []
    for i, r in enumerate(rows):
        h = holdings_for_teo(name, r["teo"])
        if h.get("report_date") == r["teo"]:
            ok.append(i)
    return ok


def stage1(name="Berkshire"):
    """Lagged always-invested series. Window i runs entry_i -> entry_{next valid book},
    holding book_i (buy-and-hold). Across a missing quarter the book is simply held
    longer — the honest always-invested behaviour. Unlagged twin uses teo_i -> teo_{next}
    with the SAME book, so lagged vs unlagged isolates the +45d entry shift only."""
    rows = portfolio_rows(name)
    teos = [pd.Timestamp(r["teo"]) for r in rows]
    entries = [entry_date(t) for t in teos]
    valid = _valid_book_indices(name, rows, teos)
    tmax = trading_days().max()
    recs = []
    for k in range(len(valid) - 1):
        i, j = valid[k], valid[k + 1]
        e_in, e_out = entries[i], entries[j]
        teo_in, teo_out = teos[i], teos[j]
        if pd.isna(e_in) or pd.isna(e_out) or e_out > tmax:
            continue
        h = holdings_for_teo(name, rows[i]["teo"])
        lag, _, cov, n, missing = portfolio_window_return(h["holdings"], e_in, e_out)
        unlag, *_ = portfolio_window_return(h["holdings"], teo_in, teo_out)
        spy_lag = spy_window(e_in, e_out)
        spy_unlag = spy_window(teo_in, teo_out)
        qlen = (e_out - e_in).days / 91.3125  # window length in quarters
        recs.append({"teo": rows[i]["teo"], "entry_date": str(e_in.date()), "exit_date": str(e_out.date()),
                     "q_len": qlen, "n_names": n, "covered_w": cov,
                     "gross_lagged": lag, "gross_unlagged_rebuild": unlag,
                     "gross_unlagged_endpoint": rows[i]["portfolio_gross_return"],
                     "spy_lagged_window": spy_lag, "spy_unlagged_window": spy_unlag,
                     "n_missing": len(missing)})
    _write(_CACHE / f"stage1_{name}.json", recs)
    return recs


# ============================ STAGE 2 ============================
# (portfolio_window_layers now lives above, backed by get_returns_decomposition)
def stage2(name="Berkshire"):
    """Lagged layer attribution via get_returns_decomposition (additive market/sector/
    subsector/idio). Validated against the endpoint's unlagged layer returns (stage2_validate)."""
    rows = portfolio_rows(name)
    teos = [pd.Timestamp(r["teo"]) for r in rows]
    entries = [entry_date(t) for t in teos]
    valid = _valid_book_indices(name, rows, teos)
    tmax = trading_days().max()
    recs = []
    for k in range(len(valid) - 1):
        i, j = valid[k], valid[k + 1]
        e_in, e_out = entries[i], entries[j]
        if pd.isna(e_in) or pd.isna(e_out) or e_out > tmax:
            continue
        h = holdings_for_teo(name, rows[i]["teo"])
        lag = portfolio_window_layers(h["holdings"], e_in, e_out)
        gross, *_ = portfolio_window_return(h["holdings"], e_in, e_out)
        qlen = (e_out - e_in).days / 91.3125
        recs.append({"teo": rows[i]["teo"], "entry_date": str(e_in.date()),
                     "exit_date": str(e_out.date()), "q_len": qlen,
                     "market": lag["market"], "sector": lag["sector"],
                     "subsector": lag["subsector"], "idio": lag["idiosyncratic"],
                     "gross": gross})
    _write(_CACHE / f"stage2_{name}.json", recs)
    return recs


def stage2_validate(name="Berkshire"):
    """Reproduce the endpoint's UNLAGGED layer returns with the get_returns_decomposition
    method, over the same 1-quarter windows. If this matches, the lagged split is sound."""
    rows = portfolio_rows(name)
    teos = [pd.Timestamp(r["teo"]) for r in rows]
    diffs = {k: [] for k in ("market", "sector", "subsector", "idiosyncratic")}
    ep_cols = {"market": "portfolio_market_return", "sector": "portfolio_sector_return",
               "subsector": "portfolio_subsector_return", "idiosyncratic": "portfolio_idiosyncratic_return"}
    for i, r in enumerate(rows):
        h = holdings_for_teo(name, r["teo"])
        if h.get("report_date") != r["teo"]:
            continue
        end = fwd_quarter_end(teos[i])
        if end > trading_days().max():
            continue
        lay = portfolio_window_layers(h["holdings"], teos[i], end)
        for k in diffs:
            ep = r.get(ep_cols[k])
            if ep is not None and not np.isnan(lay[k]):
                diffs[k].append(abs(lay[k] - ep) * 1e4)
    return {k: {"n": len(v), "mean_bps": float(np.mean(v)), "median_bps": float(np.median(v))}
            for k, v in diffs.items() if v}


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else "0"
    name = sys.argv[2] if len(sys.argv) > 2 else "Berkshire"
    if stage in ("0", "all"):
        r0 = stage0(name)
        alld = [x["diff_renorm_bps"] for x in r0 if x["diff_renorm_bps"] is not None]
        ok = [x["diff_renorm_bps"] for x in r0 if x["book_ok"] and x["diff_renorm_bps"] is not None]
        miss = [x["teo"] for x in r0 if not x["book_ok"]]
        print(f"[stage0/{name}] rows={len(r0)}")
        print(f"  ALL       n={len(alld)} mean={np.mean(alld):.1f} median={np.median(alld):.1f} max={np.max(alld):.1f}")
        print(f"  BOOK_OK   n={len(ok)} mean={np.mean(ok):.1f} median={np.median(ok):.1f} max={np.max(ok):.1f} "
              f"<25:{sum(d<25 for d in ok)} <75:{sum(d<75 for d in ok)}")
        print(f"  missing-book quarters (report_date != teo): {miss}")
    if stage in ("1", "all"):
        r1 = stage1(name)
        lag = [x["gross_lagged"] for x in r1]
        unlag = [x["gross_unlagged_rebuild"] for x in r1]
        spy = [x["spy_lagged_window"] for x in r1]
        sL, sU, sS = stats(lag), stats(unlag), stats(spy)
        print(f"[stage1/{name}] n={len(r1)}  ({sum(1 for x in r1 if x['q_len']>1.4)} multi-quarter windows)")
        for lbl, s in (("lagged", sL), ("unlagged", sU), ("SPY(lag win)", sS)):
            print(f"  {lbl:14} mean={s['mean_bps']:7.1f}bps t={s['t']:5.2f} hit={s['hit']:4.0f}% "
                  f"sharpe={s['sharpe']:5.2f} ann={s['ann_pct']:6.2f}% cum={s['cum_pct']:8.1f}%")
        surv = sL["mean_bps"] / sU["mean_bps"] * 100
        print(f"  survival: lagged mean {sL['mean_bps']:.0f} / unlagged {sU['mean_bps']:.0f} = {surv:.0f}% of gross")
    if stage in ("2", "all"):
        v = stage2_validate(name)
        print(f"[stage2-validate/{name}] ER-share vs endpoint UNLAGGED layer returns:")
        for k, d in v.items():
            print(f"  {k:14} mean|diff|={d['mean_bps']:6.1f}bps median={d['median_bps']:6.1f} (n={d['n']})")
        r2 = stage2(name)
        for k in ("market", "sector", "subsector", "idio"):
            s = stats([x[k] for x in r2])
            print(f"  LAGGED {k:12} mean={s['mean_bps']:7.1f}bps t={s['t']:5.2f} hit={s['hit']:4.0f}% sharpe={s['sharpe']:5.2f}")
    print(f"[cache] hits={_hits['hit']} misses={_hits['miss']} "
          f"rate={_hits['hit']/(_hits['hit']+_hits['miss'])*100:.0f}%")
