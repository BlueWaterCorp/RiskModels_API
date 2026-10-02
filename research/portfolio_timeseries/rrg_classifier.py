"""Relative-Rotation-Graph (RRG) regime classifier — port of Aman's code (types1.ipynb + Data.py).

Labels SECTOR and SUBSECTOR *factors* (not names) into four quadrants — Leading / Improving /
Weakening / Lagging — from weekly factor returns relative to SPY. Methodology: Rothe (2023),
"Dynamic Sector Rotation" (same RRG construction).

PORTED EXACTLY. Spans (n=10), thresholds (100), and quadrant definitions are Aman's; do NOT
change them — any difference from his numbers should be data, not method.

Construction (his cells 6/9/11):
    RS       = cumprod(1+factor_w) / cumprod(1+spy_w)          # weekly relative-strength price ratio
    rs_ratio = (RS / RS.ewm(span=10).mean()).ewm(span=10).mean() * 100
    rs_mom   = (rs_ratio / rs_ratio.ewm(span=10).mean()) * 100
    quadrant: both>100 Leading; ratio>100 & mom<100 Weakening; both<100 Lagging; ratio<100 & mom>100 Improving

Factor returns come from the FFX zarr plane gs://rm_api_public/eodhd/ds_synth_factors.zarr
(anon), 11 sector ETFs + 8 subsector codes (Aman hard-codes the 8 — the rest had missing data).
"""
from __future__ import annotations
import riskmodels  # import-order shim
import sys, json, warnings
from pathlib import Path
_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")
_CACHE = _HERE / "cache"
_CACHE.mkdir(exist_ok=True)
_CSV = _HERE / "ffx_constituents_latest.csv"
_ZARR = "gs://rm_api_public/eodhd/ds_synth_factors.zarr"

SECTORS = ["FFX_XLE", "FFX_XLB", "FFX_XLI", "FFX_XLY", "FFX_XLP", "FFX_XLV",
           "FFX_XLF", "FFX_XLK", "FFX_XLC", "FFX_XLU", "FFX_XLRE"]
SUBSECTORS = ["FFX_1210", "FFX_1420", "FFX_2105", "FFX_2205",
              "FFX_2325", "FFX_3205", "FFX_4705", "FFX_4810"]   # the 8 with complete data (Aman)
FACTORS = SECTORS + SUBSECTORS
SPAN = 10                    # Aman's ewm span — do not change
QUADRANTS = ("Leading", "Improving", "Weakening", "Lagging")

_client = None
def client():
    global _client
    if _client is None:
        _client = riskmodels.RiskModelsClient.from_env()
    return _client


# ---------------- factor returns from the zarr plane (cached) ----------------
def factor_returns_daily():
    """The 19 factor daily returns, dropna-aligned (Aman's get_ss_price). Cached to cache/."""
    p = _CACHE / "rrg_factors_daily.csv"
    if p.exists():
        return pd.read_csv(p, index_col=0, parse_dates=True)
    import xarray as xr
    ds = xr.open_zarr(_ZARR, storage_options={"token": "anon"}, consolidated=True)
    ret = ds["return"].to_pandas()
    present = [c for c in FACTORS if c in ret.columns]
    missing = [c for c in FACTORS if c not in ret.columns]
    if missing:
        raise RuntimeError(f"factor plane missing {missing} — cannot reproduce Aman's universe")
    fac = ret[present].dropna()   # Aman drops rows with any NaN across the 19
    fac.to_csv(p)
    return fac


_fw_memo = None
def factor_returns_weekly():
    """Weekly factor returns (Aman: (1+factors).resample('W').prod()-1). Memoised."""
    global _fw_memo
    if _fw_memo is None:
        fac = factor_returns_daily()
        _fw_memo = (1 + fac).resample("W").prod() - 1
    return _fw_memo


# ---------------- SPY weekly (26y, cached) ----------------
_spy_memo = {}
def spy_weekly(years=26):
    if years in _spy_memo:
        return _spy_memo[years]
    p = _CACHE / f"rrg_spy_weekly_{years}y.csv"
    if p.exists():
        s = pd.read_csv(p, index_col=0, parse_dates=True)["spy"]
        _spy_memo[years] = s
        return s
    df = client().get_ticker_returns("SPY", years=years)[["date", "returns_gross"]].copy()
    s = (1 + df.assign(date=pd.to_datetime(df["date"])).set_index("date")["returns_gross"]).resample("W").prod() - 1
    s.name = "spy"
    s.to_frame().to_csv(p)
    _spy_memo[years] = s
    return s


# ---------------- RRG core (Aman's cells 6 + 9) ----------------
def compute_rrg(factors_w, spy_w):
    """Returns (rs_ratio, rs_mom) DataFrames indexed by week, columns = factor codes."""
    idx = factors_w.index.intersection(spy_w.index)
    rs = ((1 + factors_w.loc[idx]).cumprod()).div((1 + spy_w.loc[idx]).cumprod(), axis=0).dropna()
    rs_ratio = (rs / rs.ewm(span=SPAN).mean()).ewm(span=SPAN).mean() * 100
    rs_mom = (rs_ratio / rs_ratio.ewm(span=SPAN).mean()) * 100
    return rs_ratio, rs_mom


def quad(rr, rm):
    """Aman's quadrant labels (cell 11)."""
    q = pd.DataFrame(index=rr.index, columns=rr.columns, dtype=object)
    q[(rr > 100) & (rm > 100)] = "Leading"
    q[(rr > 100) & (rm < 100)] = "Weakening"
    q[(rr < 100) & (rm < 100)] = "Lagging"
    q[(rr < 100) & (rm > 100)] = "Improving"
    return q


def full_history_labels():
    """Quadrant labels over the full history (his in-sample computation). Columns keep FFX_ prefix."""
    fw, sw = factor_returns_weekly(), spy_weekly()
    rr, rm = compute_rrg(fw, sw)
    return quad(rr, rm), fw


# ---------------- Task 2: point-in-time labels ----------------
def label_fn(as_of_date):
    """Quadrant labels using ONLY data up to as_of_date (causal filtering).

    Truncates the weekly factor + SPY series at as_of, recomputes RS/rs_ratio/rs_mom, and returns
    the LAST available week's quadrant per factor: {FFX_code: quadrant}. Because cumprod and ewm
    are causal, this equals the full-history label at that week (verified by verify_pit)."""
    as_of = pd.Timestamp(as_of_date)
    fw, sw = factor_returns_weekly(), spy_weekly()
    fw = fw[fw.index <= as_of]
    sw = sw[sw.index <= as_of]
    if len(fw) < 3 * SPAN:
        return {}
    rr, rm = compute_rrg(fw, sw)
    Q = quad(rr, rm)
    if Q.dropna(how="all").empty:
        return {}
    last = Q.dropna(how="all").index[-1]
    row = Q.loc[last]
    return {c: row[c] for c in Q.columns if pd.notna(row[c])}


def verify_pit(sample_dates=None):
    """Verify point-in-time labels equal the full-history labels at the same week (no leakage).
    Returns (all_match, details). If any mismatch, PIT is contaminated and must not be used."""
    Qfull, _ = full_history_labels()
    valid = Qfull.dropna(how="all").index
    if sample_dates is None:
        # spread across the history
        picks = np.linspace(3 * SPAN, len(valid) - 1, 8).astype(int)
        sample_dates = [valid[i] for i in picks]
    details = []
    all_match = True
    for d in sample_dates:
        pit = label_fn(d)
        # full-history label at the last week <= d
        wk = valid[valid <= pd.Timestamp(d)][-1]
        full = {c: Qfull.loc[wk, c] for c in Qfull.columns if pd.notna(Qfull.loc[wk, c])}
        match = pit == full
        all_match = all_match and match
        details.append({"as_of": str(pd.Timestamp(d).date()), "week": str(wk.date()),
                        "match": match, "n_factors": len(full),
                        "mismatches": {k: (pit.get(k), full.get(k)) for k in set(pit) | set(full)
                                       if pit.get(k) != full.get(k)}})
    return all_match, details


# ---------------- Task 1: reproduce Aman's validation ----------------
def validate_reproduction(target="Improving", H=24):
    """Reproduce his cell-11 result: SECTORS only, entry into `target`, H-week horizon.
    Returns dict(n_signals, prob_gain_pct, mean_ret_pct, ann_pct). His numbers: 517 / 76.60% / 6.15%."""
    fw, sw = factor_returns_weekly(), spy_weekly()
    rr, rm = compute_rrg(fw, sw)
    Q = quad(rr, rm); Q.columns = [c.replace("FFX_", "") for c in Q.columns]
    R = fw.copy(); R.columns = [c.replace("FFX_", "") for c in R.columns]
    SECT = [c for c in Q.columns if c.startswith("XL")]
    Q, R = Q[SECT], R[SECT]
    idx = Q.dropna(how="all").index
    inq = (Q == target)
    entry = inq & (~inq.shift(1).fillna(False))
    rets, wk = [], list(idx)
    for i, t in enumerate(wk):
        if i + H >= len(wk):
            break
        for nm in entry.columns[entry.loc[t].values]:
            win = wk[i + 1: i + H + 1]
            cum = (1 + R.loc[win, nm]).prod() - 1
            if np.isfinite(cum):
                rets.append(cum)
    rets = np.array(rets)
    return {"target": target, "H": H, "n_signals": int(len(rets)),
            "prob_gain_pct": float((rets > 0).mean() * 100),
            "mean_ret_pct": float(rets.mean() * 100),
            "ann_pct": float(((1 + rets.mean()) ** (52 / H) - 1) * 100)}


# ---------------- ticker -> sector / subsector maps (Aman's Data.get_sector_subsector_mapping) ----------------
def ticker_maps():
    """Returns (sector_map, subsector_map): ticker -> FFX factor code.
    Subsector map is restricted to the 8 factors in Aman's classifier universe."""
    df = pd.read_csv(_CSV)
    fac = df["factor"].str.replace("FFX_", "")
    sector_map = df[~fac.str.isdigit()].set_index("ticker")["factor"]
    sub_all = df[fac.str.isdigit()].set_index("ticker")["factor"]
    sub_map = sub_all[sub_all.isin(SUBSECTORS)]   # only the 8 with complete data
    return sector_map.to_dict(), sub_map.to_dict()


if __name__ == "__main__":
    print("=== TASK 1 — reproduce Aman's validation (SECTORS, Improving, H=24) ===")
    r = validate_reproduction()
    print(f"  n_signals={r['n_signals']} (his 517) | prob_gain={r['prob_gain_pct']:.2f}% (his 76.60%) "
          f"| mean={r['mean_ret_pct']:.2f}% (his 6.15%) | ann={r['ann_pct']:.2f}% (his ~13.81%)")
    ok = abs(r["n_signals"] - 517) <= 25
    print(f"  MATCH: {'PASS' if ok else 'FAIL — signal count materially different, STOP'}")
    print("\n=== TASK 2 — point-in-time label verification ===")
    allm, det = verify_pit()
    for d in det:
        print(f"  as_of {d['as_of']} (week {d['week']}): match={d['match']} n={d['n_factors']}"
              + (f" MISMATCH {d['mismatches']}" if not d["match"] else ""))
    print(f"  PIT VERIFICATION: {'PASS — no leakage' if allm else 'FAIL — labels contaminated, DO NOT USE'}")
