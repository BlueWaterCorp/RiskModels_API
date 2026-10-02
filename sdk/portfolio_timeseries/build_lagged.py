"""Lagged 13F backtest pipeline — daily name-level rebuild of a filer's disclosed book.

Stages, each gated before the next may be published (see LAGGED_RESULTS.md and
HANDOFF.md §5):
  0  validate the daily buy-and-hold rebuild against the endpoint's own gross return
     (`gate_verdict`: mean |diff| <25 bps CLEAN / 25-75 PROCEED_WITH_FLAG / >75 STOP)
  1  lagged gross series: enter at teo+45 CALENDAR days rolled to a trading day, floored at
     the date the book is provably public (`lagged_entry`); hold to the next entry
  2  additive market/sector/subsector/idio attribution from get_returns_decomposition,
     validated against the endpoint's own per-quarter layer returns
     (`layer_gate_verdict`: per-layer median |diff| < 50 bps)

Filers run so far: Berkshire (passes), D. E. Shaw and Pershing (both STOP at Stage 0 and
publish nothing downstream). Coverage is always reported; renormalising to covered names
is an explicit imputation — see `portfolio_window_return`.

Everything caches to cache/ keyed by (filer, vintage) / ticker, so a timeout never loses
work and re-runs resume from cache. CLI:  python build_lagged.py {0|1|2|all} [Filer]
Stages 1 and 2 refuse to run after a Stage 0 STOP unless `--force` is passed.
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


def terminal_teo(name):
    """The teo of the endpoint's TERMINAL row — the one whose `portfolio_gross_return` is
    measured over an open-ended window (quarter end → data horizon) instead of one quarter.
    Documented in DATA_ISSUES.md (2026-09-07) and tracked upstream as BWMACRO D.8.56.

    Detected by PROPERTY, not by position: it is the maximum teo of the RAW endpoint series,
    taken before null-gross rows are filtered. Taking `[-1]` of the filtered list is what the
    first version did, which breaks the moment the endpoint's last row has a null gross
    (the terminal row would be a different, kept row) — PR #373 review, finding 5.

    Note that the obvious alternative property — "the forward quarter is not complete in the
    trading calendar" — does NOT fire for this defect: the calendar runs well past every
    filer's last quarter end, yet the terminal row is still mis-measured. The implied-horizon
    diagnostic in reaudit_berkshire.py is the evidence that the row is defective; this
    function is the rule for which row it is.
    """
    fid = FILERS[name]
    raw = _read(_CACHE / f"portfolio_{fid}.json")
    if raw is None:
        raw = client().get_filer_portfolio(fid)["rows"]
        _write(_CACHE / f"portfolio_{fid}.json", raw)
    return max(r["teo"] for r in raw)


def is_terminal(name, teo):
    return str(teo)[:10] == terminal_teo(name)


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


def book_truncation(rec):
    """How much of the disclosed book the 1,000-row `get_filer_holdings` cap leaves unlisted.

    The endpoint returns the top `_HOLDINGS_LIMIT` rows by weight, and the weights it returns
    are weights OF THE FULL BOOK (they sum to < 1 when the book was truncated), so:
      * `covered_w` from `portfolio_window_return` is already an ABSOLUTE share of the full
        book — the unlisted tail is uncovered by construction;
      * but that tail never appears in the `missing` list, because it was never returned.
    This reports it explicitly so every coverage figure can state its basis (PR #373 review,
    finding 6). For D. E. Shaw the tail is a median 0.4% of weight, max 3.2%, on 71 of 74
    books; the SDK offers no paging, so the basis is stated rather than closed.
    """
    hs = rec.get("holdings") or []
    wsum = float(sum((x.get("weight") or 0.0) for x in hs))
    n_total = rec.get("n_total_holdings")
    n_ret = rec.get("n_holdings_returned") or len(hs)
    return {"n_total": n_total, "n_returned": n_ret,
            "truncated": bool(n_total and n_total > n_ret),
            "returned_w_sum": wsum, "tail_w": max(0.0, 1.0 - wsum)}


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
    renormalised to covered names, from the additive get_returns_decomposition series.

    Returns the four layers PLUS `covered_w` (absolute book weight with a decomposition
    series) and `n_names`, so no layer figure is ever published without its coverage
    (PR #373 review, finding 7). The renormalisation is the same explicit imputation as
    `portfolio_window_return`: uncovered weight is assigned the covered book's layer return.
    """
    layers = {"market": 0.0, "sector": 0.0, "subsector": 0.0, "idiosyncratic": 0.0}
    covered = 0.0
    n = 0
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
        n += 1
    if covered <= 0:
        out = {k: float("nan") for k in layers}
    else:
        out = {k: v / covered for k, v in layers.items()}
    out["covered_w"] = float(covered)
    out["n_names"] = n
    return out


def window_return(ticker, start, end):
    """Buy-and-hold total return of one name over (start, end]. None if no data.

    Drops NaN return days before compounding — same data-quality gaps that bite the decomp
    path (name_layer_windows). Without this, a single name with one NaN day returns NaN, which
    still counts toward `covered` in portfolio_window_return but poisons the whole portfolio sum
    (one 3bps freshly-IPO'd name nulled entire early D.E.Shaw quarters). If every day in the
    window is NaN the name has no usable data -> None (skipped, not treated as 0).

    Known limitation (PR #373 review, finding 8): dropping a NaN day is equivalent to a ZERO
    return on that day. That is right when the vendor's next print spans the gap (the price
    move is captured on the next printed day). It is WRONG for a NaN TAIL — a delisting with
    no terminal print — where the loss after the last print is simply not seen: the name
    compounds over its printed days only and still counts as covered. Pinned, as documented
    behaviour rather than as a fix, in tests/test_window_primitives.py."""
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
    Returns (gross_renorm, gross_asis, covered_weight, n_names, missing).

    `gross_renorm = Σ_covered w_i R_i / Σ_covered w_i` is an EXPLICIT IMPUTATION: the
    uncovered weight is assumed to have earned the covered book's return. It is the
    defensible choice for a partial universe, but it is a fill, which is why `covered_weight`
    travels with every figure and is stated on every published result (PR #373, finding 7).
    `covered_weight` is ABSOLUTE book weight: the endpoint's weights are of the full book, so
    names past the 1,000-row cap count as uncovered by construction even though they never
    appear in `missing` (see `book_truncation`)."""
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


def book_public_date(rec, teo):
    """Earliest date at which a holdings record is PROVABLY public. Timestamp or NaT.

    Two sources, both consulted:
      * the record's own ``filing_date``;
      * ``as_of_requested`` when the fetch had to escalate past the tight teo+55 buffer.
        Escalation is itself evidence: if teo+55 returned the prior book, this book was not
        retrievable then, so an earlier ``filing_date`` in the record cannot be taken at
        face value.

    Used to floor the lagged entry so a book is never entered before it existed. Found in
    review (2026-09-22): ``holdings_for_teo`` escalates as_of to teo+90/+120 for late
    filings, but ``stage1`` entered every book at teo+45 regardless — look-ahead for any
    quarter that needed the escalation.
    """
    cands = []
    fd = rec.get("filing_date") if rec else None
    if fd:
        cands.append(pd.Timestamp(fd))
    aor = rec.get("as_of_requested") if rec else None
    if aor:
        aor = pd.Timestamp(aor)
        if (aor - pd.Timestamp(teo)).days > 55:
            cands.append(aor)
    return max(cands) if cands else pd.NaT


def lagged_entry(teo, rec):
    """Lagged-series entry: teo+45 calendar days, but never before the book is provably
    public. Returns (entry, floored) where `floored` says the public date was binding."""
    e = entry_date(teo)
    pub = book_public_date(rec, teo)
    if pd.isna(pub):
        return e, False
    td = trading_days()
    nxt = td[td >= pub]
    p = nxt[0] if len(nxt) else pd.NaT
    if pd.isna(p):
        return e, False
    if pd.isna(e):
        return p, True
    return (p, True) if p > e else (e, False)


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


def stats_qnorm(recs, value_fn, qlen_key="q_len"):
    """Statistics for a series of windows whose LENGTHS DIFFER.

    A book held across a missing quarter produces a ~2-quarter window. Treating that as one
    quarterly draw doubles its mean and inflates t, Sharpe and the annualised figure, and
    `stats()` compounds the error by annualising with n/4 years.

    Here the moments (mean, t, hit, Sharpe) are computed on the PER-QUARTER contribution
    (window return / q_len), so every observation is a comparable quarterly draw, while the
    cumulative and annualised figures use the TRUE compounded path over the SUMMED window
    length in years.

    Found in review (2026-09-22): the headline gross series was fed to `stats()`
    unnormalised while the layer series was already divided by q_len — which is why the same
    lagged book read Sharpe 0.99 in the headline table and 0.95 in the layer table.
    `value_fn(rec)` returns the raw window return; `qlen_key` names the length column.
    """
    raw, qs = [], []
    for r in recs:
        v = value_fn(r)
        q = r.get(qlen_key)
        if v is None or q in (None, 0) or (isinstance(v, float) and np.isnan(v)):
            continue
        raw.append(float(v))
        qs.append(float(q))
    if not raw:
        return {}
    raw = np.asarray(raw)
    qs = np.asarray(qs)
    per_q = raw / qs                      # comparable quarterly draws
    m, sd = per_q.mean(), per_q.std(ddof=1)
    t = m / (sd / np.sqrt(len(per_q))) if sd > 0 else float("nan")
    cum = float(np.prod(1 + raw) - 1)     # true compounded path, on the RAW returns
    yrs = qs.sum() / 4.0                  # summed window length, not n/4
    return {"n": len(per_q), "mean_bps": m * 1e4, "std_bps": sd * 1e4, "t": t,
            "hit": float((per_q > 0).mean() * 100),
            "sharpe": (m / sd) * np.sqrt(4) if sd > 0 else float("nan"),
            "ann_pct": ((1 + cum) ** (1 / yrs) - 1) * 100 if yrs > 0 else float("nan"),
            "cum_pct": cum * 100,
            "years": yrs, "q_len_sum": float(qs.sum()),
            "n_multi_quarter": int((qs > 1.25).sum())}


# ---- the validation gates, as functions so the thresholds are explicit and ENFORCED ----
# Both pre-registered before any lagged analysis was run, so a marginal result could not
# retro-fit the bar. Two gates, two statistics, deliberately:
#
#   Stage 0 (gross)  — gate_verdict on the MEAN |rebuild - endpoint| in bps. The mean, not
#                      the median: the median hides exactly the tail quarters where a
#                      rebuild diverges most, and a rebuild that is wrong in the tail is
#                      wrong where it matters.
#   Stage 2 (layers) — layer_gate_verdict on each layer's MEDIAN |diff| < 50 bps. Per-layer
#                      distributions are tail-heavy from the SAME high-vol quarters the Stage
#                      0 mean already penalised; the layer gate asks whether the typical
#                      quarter's attribution reproduces, given the gross already passed.
#
# PR #373 review, finding 4: these constants existed but nothing in this module called them,
# and the layer bar was a literal in three files. They now live here and every stage runs
# through `enforce_gate` / `layer_gate_verdict`.
GATE_CLEAN_BPS = 25.0
GATE_STOP_BPS = 75.0
LAYER_GATE_MEDIAN_BPS = 50.0


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


def layer_gate_verdict(validation, bar=LAYER_GATE_MEDIAN_BPS):
    """Stage 2 gate. `validation` is {layer: {"median_bps": ..., ...}} as returned by
    `stage2_validate`. PASS iff every layer's median |diff| is under `bar`; the failing
    layers are returned so the reason is reportable, not just the verdict."""
    failing = {k: v["median_bps"] for k, v in validation.items()
               if v and v.get("median_bps") is not None and v["median_bps"] >= bar}
    return ("PASS" if not failing else "FAIL"), failing


def stage0_summary(name, recs=None, drop_terminal=True):
    """Stage 0 statistics on buildable, non-terminal quarters — the numbers the gate is
    applied to. Returns a dict with n / mean / median / max / verdict, and the terminal teo
    that was excluded. Every caller that quotes a Stage 0 figure should use this."""
    recs = stage0(name) if recs is None else recs
    term = terminal_teo(name) if drop_terminal else None
    ok = [x for x in recs if x["book_ok"] and x["diff_renorm_bps"] is not None
          and (term is None or x["teo"] != term)]
    if not ok:
        return {"n": 0, "verdict": "STOP", "terminal_teo": term, "mean_bps": float("nan")}
    d = np.array([x["diff_renorm_bps"] for x in ok], float)
    cov = np.array([x["covered_w"] for x in ok], float)
    return {"n": int(len(d)), "mean_bps": float(d.mean()), "median_bps": float(np.median(d)),
            "max_bps": float(d.max()), "n_under_25": int((d < GATE_CLEAN_BPS).sum()),
            "n_under_75": int((d < GATE_STOP_BPS).sum()),
            "coverage_median": float(np.median(cov)), "coverage_min": float(cov.min()),
            "verdict": gate_verdict(float(d.mean())), "terminal_teo": term,
            "missing_book_teos": [x["teo"] for x in recs if not x["book_ok"]]}


class GateStop(RuntimeError):
    """Raised by `enforce_gate` when a stage's gate reads STOP and the caller did not force."""


def enforce_gate(name, force=False):
    """Run Stage 0 and REFUSE to continue on STOP. Returns the summary on pass/flag.
    `force=True` only downgrades the refusal to a loud warning — for diagnostics, never for
    publication. This is the single control point every downstream stage goes through."""
    g = stage0_summary(name)
    if g["verdict"] == "STOP":
        msg = (f"[{name}] Stage 0 gate = STOP (mean {g['mean_bps']:.1f} bps > {GATE_STOP_BPS:.0f}). "
               f"Downstream numbers are not to be published.")
        if not force:
            raise GateStop(msg)
        print("!! " + msg + "  (--force: continuing for DIAGNOSTICS ONLY)")
    return g


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
    term = terminal_teo(name)                            # dropped from the gate by property (F5)
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
                     "is_terminal": bool(r["teo"] == term),
                     "report_date": h.get("report_date"), "book_ok": book_ok,
                     **{f"book_{k}": v for k, v in book_truncation(h).items()},
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
    valid = _valid_book_indices(name, rows, teos)
    # Entry is floored at each book's provable public date, so a late-filed book is never
    # entered before it existed. For Berkshire this is never binding (0 of 43 books escalate
    # past teo+55); it bites for filers that file late, e.g. Pershing (10 of 77).
    books = {i: holdings_for_teo(name, rows[i]["teo"]) for i in valid}
    ent = {}
    for i in valid:
        ent[i] = lagged_entry(teos[i], books[i])
    tmax = trading_days().max()
    recs = []
    for k in range(len(valid) - 1):
        i, j = valid[k], valid[k + 1]
        (e_in, floored_in), (e_out, _) = ent[i], ent[j]
        teo_in, teo_out = teos[i], teos[j]
        if pd.isna(e_in) or pd.isna(e_out) or e_out > tmax:
            continue
        h = books[i]
        lag, _, cov, n, missing = portfolio_window_return(h["holdings"], e_in, e_out)
        unlag, *_ = portfolio_window_return(h["holdings"], teo_in, teo_out)
        spy_lag = spy_window(e_in, e_out)
        spy_unlag = spy_window(teo_in, teo_out)
        qlen = (e_out - e_in).days / 91.3125  # window length in quarters
        recs.append({"teo": rows[i]["teo"], "entry_date": str(e_in.date()), "exit_date": str(e_out.date()),
                     "q_len": qlen, "n_names": n, "covered_w": cov,
                     "entry_floored": bool(floored_in),
                     "as_of_requested": h.get("as_of_requested"),
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
    valid = _valid_book_indices(name, rows, teos)
    books = {i: holdings_for_teo(name, rows[i]["teo"]) for i in valid}
    ent = {i: lagged_entry(teos[i], books[i]) for i in valid}   # same flooring as stage1
    tmax = trading_days().max()
    recs = []
    for k in range(len(valid) - 1):
        i, j = valid[k], valid[k + 1]
        e_in, e_out = ent[i][0], ent[j][0]
        if pd.isna(e_in) or pd.isna(e_out) or e_out > tmax:
            continue
        h = books[i]
        lag = portfolio_window_layers(h["holdings"], e_in, e_out)
        gross, *_ = portfolio_window_return(h["holdings"], e_in, e_out)
        qlen = (e_out - e_in).days / 91.3125
        recs.append({"teo": rows[i]["teo"], "entry_date": str(e_in.date()),
                     "exit_date": str(e_out.date()), "q_len": qlen,
                     "market": lag["market"], "sector": lag["sector"],
                     "subsector": lag["subsector"], "idio": lag["idiosyncratic"],
                     "gross": gross,
                     "layer_covered_w": lag["covered_w"], "layer_n_names": lag["n_names"]})
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
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    stage = args[0] if args else "0"
    name = args[1] if len(args) > 1 else "Berkshire"
    if stage in ("0", "all"):
        g = stage0_summary(name)
        print(f"[stage0/{name}] n={g['n']} (terminal row {g['terminal_teo']} dropped by property)")
        print(f"  mean={g['mean_bps']:.1f} median={g['median_bps']:.1f} max={g['max_bps']:.1f} "
              f"<25:{g['n_under_25']} <75:{g['n_under_75']}  coverage median={g['coverage_median']:.1%}")
        print(f"  missing-book quarters (report_date != teo): {g['missing_book_teos']}")
        print(f"  >>> VERDICT: {g['verdict']}")
    if stage in ("1", "2", "all"):
        enforce_gate(name, force=force)          # STOP here means nothing below is published
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
        print(f"[stage2-validate/{name}] rebuild vs endpoint UNLAGGED layer returns:")
        for k, d in v.items():
            print(f"  {k:14} mean|diff|={d['mean_bps']:6.1f}bps median={d['median_bps']:6.1f} (n={d['n']})")
        lv, failing = layer_gate_verdict(v)
        print(f"  >>> LAYER GATE: {lv}" + (f"  failing={failing}" if failing else ""))
        if lv == "FAIL" and not force:
            print("  layer attribution withheld (pass --force for diagnostics only)")
        else:
            r2 = stage2(name)
            for k in ("market", "sector", "subsector", "idio"):
                s = stats_qnorm(r2, lambda x, k=k: x[k])
                print(f"  LAGGED {k:12} mean={s['mean_bps']:7.1f}bps t={s['t']:5.2f} hit={s['hit']:4.0f}% "
                      f"sharpe={s['sharpe']:5.2f}  (layer coverage median "
                      f"{np.median([x['layer_covered_w'] for x in r2]):.1%})")
    print(f"[cache] hits={_hits['hit']} misses={_hits['miss']} "
          f"rate={_hits['hit']/(_hits['hit']+_hits['miss'])*100:.0f}%")
