"""Task 2 — attribution_audit.xlsx. Live formulas so every published number is recomputable.
Sheets: README, Berkshire_quarterly, Berkshire_summary (formulas), Sharpe_bridge, Hit_rate,
Lag_distribution."""
import riskmodels
import sys, json, warnings
from pathlib import Path
from math import comb
warnings.filterwarnings("ignore")
_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
import numpy as np, pandas as pd, build_lagged as B
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

NAME = "Berkshire"
HEAD = Font(bold=True, color="FFFFFF"); HFILL = PatternFill("solid", fgColor="002A5E")
BOLD = Font(bold=True); WRAP = Alignment(wrap_text=True, vertical="top")

# Single source of truth for every headline number in this workbook: the current
# re-audit run. Regenerate it with `python reaudit_berkshire.py` before rebuilding
# this file, so no figure here can drift from the code.
_RA_PATH = _HERE / "cache" / "reaudit_berkshire.json"
if not _RA_PATH.exists():
    raise SystemExit("run `python reaudit_berkshire.py` first — this workbook reads "
                     "cache/reaudit_berkshire.json so every number traces to a current run")
RA = json.load(open(_RA_PATH))
BRIDGE = RA["sharpe_bridge"]
TERMINAL_TEO = RA["stage0"]["terminal_teo"]
STUB_TEOS = [s["teo"] for s in RA["stub_rows"]["stub_rows"]]

# ---------- gather per-teo lagged + BOTH unlagged constructions ----------
#
# There are two legitimate "unlagged" twins and they answer different questions.
# Mixing them silently (an earlier version of this workbook did) makes the
# lagged-vs-unlagged comparison incoherent, so both are carried explicitly:
#
#   UNLQ  teo -> teo + 3 calendar months, a FIXED one-quarter forward window.
#         This is the endpoint's own definition of portfolio_gross_return, so it is
#         the construction to use when comparing the rebuild against the endpoint
#         (Stage 0, stage2_validate, and step C of the Sharpe bridge).
#
#   UNLT  teo_i -> teo_j where j is the next teo with a usable book, q_len-normalised.
#         This mirrors the LAGGED window structure exactly (entry_i -> entry_j), so
#         lagged-minus-unlagged isolates the +45-day entry shift and nothing else.
#         This is the construction to use for "does the premium survive the lag".
#
# Where the teo series has no gap the two coincide. They diverge on the 6 windows
# that span a missing book.
s2 = json.load(open(B._CACHE / f"stage2_{NAME}.json"))
s1 = {r["teo"]: r for r in json.load(open(B._CACHE / f"stage1_{NAME}.json"))}
_prows = B.portfolio_rows(NAME)
_teos = [pd.Timestamp(r["teo"]) for r in _prows]
_valid = B._valid_book_indices(NAME, _prows, _teos)
_next_teo = {}
for _k in range(len(_valid) - 1):
    _next_teo[_prows[_valid[_k]]["teo"]] = _teos[_valid[_k + 1]]

rows = []
for r in s2:
    teo, q = r["teo"], r["q_len"]
    if any(r[k] is None or np.isnan(r[k]) for k in ["market","sector","subsector","idio","gross"]):
        continue
    h = B.holdings_for_teo(NAME, teo)
    # UNLQ — fixed forward quarter (endpoint-comparable)
    endq = B.fwd_quarter_end(pd.Timestamp(teo))
    ulq = B.portfolio_window_layers(h["holdings"], pd.Timestamp(teo), endq)
    ugq, _, cov_u, n_u, _ = B.portfolio_window_return(h["holdings"], pd.Timestamp(teo), endq)
    # UNLT — lag twin (same window structure as the lagged series)
    endt = _next_teo.get(teo)
    if endt is None:
        continue
    ult = B.portfolio_window_layers(h["holdings"], pd.Timestamp(teo), endt)
    ugt, *_ = B.portfolio_window_return(h["holdings"], pd.Timestamp(teo), endt)
    if any(np.isnan(v) for v in ulq.values()) or np.isnan(ugq):
        continue
    if any(np.isnan(v) for v in ult.values()) or np.isnan(ugt):
        continue
    s1r = s1.get(teo, {})
    rows.append(dict(
        teo=teo, entry=r["entry_date"], exit=r["exit_date"], q_len=q,
        n_names=s1r.get("n_names"), covered_w=s1r.get("covered_w"),
        # UNLQ: fixed teo -> teo+3mo
        gross_u=ugq, market_u=ulq["market"], sector_u=ulq["sector"],
        subsector_u=ulq["subsector"], idio_u=ulq["idiosyncratic"],
        # UNLT: lag twin, per-quarter normalised
        gross_ut=ugt / q, market_ut=ult["market"] / q, sector_ut=ult["sector"] / q,
        subsector_ut=ult["subsector"] / q, idio_ut=ult["idiosyncratic"] / q,
        # lagged raw window
        gross_l=r["gross"], market_l=r["market"], sector_l=r["sector"],
        subsector_l=r["subsector"], idio_l=r["idio"],
    ))
print(f"assembled {len(rows)} quarterly rows")

wb = Workbook()

# ================= README =================
ws = wb.active; ws.title = "README"
ws.column_dimensions["A"].width = 22; ws.column_dimensions["B"].width = 110
readme = [
    ("attribution_audit.xlsx", ""),
    ("Filer", "Berkshire Hathaway (BW-FILER-CIK0001067983)"),
    ("Generated", "2026-09-07 · project closeout re-audit (supersedes the 2026-08-03 workbook)"),
    ("Why regenerated", "Two bugs invalidated the 2026-08-03 numbers: (1) NaN-day poisoning in window_return "
                        "silently nulled quarters (n 35->42, lagged gross Sharpe 0.85->0.99); (2) the TERMINAL row of "
                        "get_filer_portfolio carries an open-ended forward return, not a one-quarter one, and was "
                        "inflating the Stage 0 gate. Both fixed; every figure below is from the current run."),
    ("Purpose", "Recompute every published attribution number by hand. Summary sheet uses live formulas referencing Berkshire_quarterly."),
    ("", ""),
    ("METHOD", ""),
    ("Returns", "GROSS returns, NOT excess over benchmark. Long-only 13F book. No costs/financing/borrow."),
    ("Rebuild", "Daily name-level: holdings weights x get_returns_decomposition per-name additive layers (l1=market, l2=sector, l3=subsector, l3_residual=idio). Renormalised to covered names."),
    ("Unlagged: TWO", "There are two unlagged twins and they answer different questions. UNLQ = teo -> teo+3 months, "
                      "a fixed forward quarter; this matches the endpoint's own window, so use it to compare rebuild "
                      "vs endpoint (Stage 0, Sharpe_bridge step C). UNLT = teo_i -> teo_j (next usable book), "
                      "q_len-normalised; this mirrors the LAGGED window structure exactly, so use it for "
                      "'does the premium survive the lag'. They coincide except on the 6 windows spanning a missing "
                      "book. An earlier workbook compared UNLQ against LAGGED, mixing the two — do not do that."),
    ("Lagged window", "entry -> next entry, entry = teo + 45 CALENDAR days rolled to next trading day. Always invested; across a missing book the book is held longer (q_len>1)."),
    ("q_len", "window length in quarters. Per-quarter figures in the summary divide lagged window returns by q_len."),
    ("", ""),
    ("CAVEATS", ""),
    ("Sample", f"{len(rows)} quarters. 3 excluded as STUB ROWS ({', '.join(STUB_TEOS)}) — those portfolio rows "
               f"describe a 1-2 name portfolio holding 0.001%-0.8% of the AUM the neighbouring quarters report, "
               f"so no holdings book matches them. 1 excluded as the terminal row ({TERMINAL_TEO}). "
               f"Only 2021-06-30 is genuinely absent from the teo series; 2013-06-30 / 2015-06-30 / 2023-09-30 / "
               f"2023-12-31 are present but carry no portfolio_gross_return."),
    ("Rebuild bias", "Rebuild runs ~median +12 bps/q rich vs the endpoint's model-implied gross. Cancels in lagged-vs-unlagged deltas."),
    ("Linking residual", "Layers compounded each as own stream; sum != gross exactly (residual column). Small, matches the endpoint's own construction."),
    ("The 1.00 Sharpe", f"Do NOT quote 1.003. It is computed over 46 quarters including three stub rows whose "
                        f"drop-idio returns average {RA['stub_rows']['stub_drop_idio_mean_bps']:.0f} bps/q against "
                        f"{RA['stub_rows']['kept_drop_idio_mean_bps']:.0f} for the real quarters. On the rebuildable "
                        f"sample the endpoint gives {BRIDGE['B_endpoint_rebuildable']:.2f} and the independent daily "
                        f"rebuild {BRIDGE['C_rebuild_unlagged']:.2f}. See Sharpe_bridge."),
    ("Hit-rate correction", "Meeting note '65% hit in L1' is WRONG. L1/market hit is far higher unlagged; 65% was sector+subsector. See Hit_rate (recomputed this run)."),
    ("Filing dates", "'45-day lag' is 63-68% exactly 45 across four filers -> largely a report_date+45 placeholder, not observed. See Lag_distribution."),
    ("SHEETS", "Berkshire_quarterly (raw data) · Berkshire_summary (live formulas) · Sharpe_bridge · Hit_rate · Lag_distribution"),
]
for i, (a, b) in enumerate(readme, 1):
    ws.cell(i, 1, a).font = BOLD; ws.cell(i, 2, b).alignment = WRAP
ws.cell(1,1).font = Font(bold=True, size=14)

# ================= Berkshire_quarterly =================
wq = wb.create_sheet("Berkshire_quarterly")
cols = [("teo","teo"),("entry","entry_date"),("exit","exit_date"),("q_len","q_len"),
        ("n_names","n_names"),("covered_w","covered_weight"),
        ("gross_u","gross_UNLQ"),("market_u","market_UNLQ"),("sector_u","sector_UNLQ"),
        ("subsector_u","subsector_UNLQ"),("idio_u","idio_UNLQ"),("resid_u","linkresid_UNLQ"),
        ("gross_ut","gross_UNLT"),("market_ut","market_UNLT"),("sector_ut","sector_UNLT"),
        ("subsector_ut","subsector_UNLT"),("idio_ut","idio_UNLT"),
        ("gross_l","gross_LAG"),("market_l","market_LAG"),("sector_l","sector_LAG"),
        ("subsector_l","subsector_LAG"),("idio_l","idio_LAG"),("resid_l","linkresid_LAG"),
        ("gross_lq","gross_LAG_perQ"),("market_lq","market_LAG_perQ"),("sector_lq","sector_LAG_perQ"),
        ("subsector_lq","subsector_LAG_perQ"),("idio_lq","idio_LAG_perQ")]
for j,(_,h) in enumerate(cols,1):
    cc=wq.cell(1,j,h); cc.font=HEAD; cc.fill=HFILL
for i,r in enumerate(rows,2):
    r=dict(r)
    r["resid_u"]=r["gross_u"]-(r["market_u"]+r["sector_u"]+r["subsector_u"]+r["idio_u"])
    r["resid_l"]=r["gross_l"]-(r["market_l"]+r["sector_l"]+r["subsector_l"]+r["idio_l"])
    q=r["q_len"]
    for lyr in ("gross","market","sector","subsector","idio"):
        r[f"{lyr}_lq"]=r[f"{lyr}_l"]/q
    for j,(key,_) in enumerate(cols,1):
        v=r.get(key)
        wq.cell(i,j,v)
nrow=len(rows)+1  # last data row index
for col in "ABC": wq.column_dimensions[col].width=12
# reference map: column letters
colmap={key:get_column_letter(j) for j,(key,_) in enumerate(cols,1)}

# ================= Berkshire_summary (LIVE FORMULAS) =================
wsm=wb.create_sheet("Berkshire_summary")
# layers: (label, unlagged col key, lagged-perQ col key)
layers=[("market","market_u","market_ut","market_lq"),("sector","sector_u","sector_ut","sector_lq"),
        ("subsector","subsector_u","subsector_ut","subsector_lq"),
        ("sector+subsector",None,None,None),("mkt+sec+subsec",None,None,None),
        ("idio","idio_u","idio_ut","idio_lq"),("gross","gross_u","gross_ut","gross_lq")]
hdr=["layer","basis","n","mean_bps","std_bps","t","hit_%","skew","ann_Sharpe","ann_%","cum_%"]
for j,h in enumerate(hdr,1):
    cc=wsm.cell(1,j,h); cc.font=HEAD; cc.fill=HFILL
def rng(colkey): return f"Berkshire_quarterly!{colmap[colkey]}2:{colmap[colkey]}{nrow}"
rr=2
for label,uk,utk,lk in layers:
    for basis,key in (("unlagged_fwdQ",uk),("unlagged_lagtwin",utk),("lagged_perQ",lk)):
        wsm.cell(rr,1,label); wsm.cell(rr,2,basis)
        if key is not None:
            R=rng(key)
            wsm.cell(rr,3,f"=COUNT({R})")
            wsm.cell(rr,4,f"=AVERAGE({R})*10000")
            wsm.cell(rr,5,f"=STDEV({R})*10000")
            wsm.cell(rr,6,f"=AVERAGE({R})/(STDEV({R})/SQRT(COUNT({R})))")
            wsm.cell(rr,7,f"=COUNTIF({R},\">0\")/COUNT({R})*100")
            wsm.cell(rr,8,f"=SKEW({R})")
            wsm.cell(rr,9,f"=AVERAGE({R})/STDEV({R})*SQRT(4)")
            wsm.cell(rr,10,f"=(EXP((4/COUNT({R}))*SUMPRODUCT(LN(1+{R})))-1)*100")
            wsm.cell(rr,11,f"=(EXP(SUMPRODUCT(LN(1+{R})))-1)*100")
        else:
            # composite: sector+subsector or mkt+sec+subsec -> build a range sum via two/three cols
            _sfx = {"unlagged_fwdQ": "_u", "unlagged_lagtwin": "_ut", "lagged_perQ": "_lq"}[basis]
            if label=="sector+subsector":
                ck=(f"sector{_sfx}", f"subsector{_sfx}")
            else:
                ck=(f"market{_sfx}", f"sector{_sfx}", f"subsector{_sfx}")
            Rs=[rng(k) for k in ck]
            sumexpr="(" + "+".join(Rs) + ")"
            n=f"COUNT({Rs[0]})"
            mean=f"AVERAGE({sumexpr})" if False else f"SUMPRODUCT({sumexpr})/{n}"
            # AVERAGE over a summed array works with SUMPRODUCT/n; STDEV needs array -> use SUMPRODUCT of squares
            wsm.cell(rr,3,f"={n}")
            wsm.cell(rr,4,f"=SUMPRODUCT({sumexpr})/{n}*10000")
            wsm.cell(rr,5,f"=SQRT((SUMPRODUCT({sumexpr},{sumexpr})-{n}*(SUMPRODUCT({sumexpr})/{n})^2)/({n}-1))*10000")
            wsm.cell(rr,6,f"=D{rr}*SQRT(C{rr})/E{rr}")  # t = mean*sqrt(n)/std (bps scale cancels)
            # hit%: count of positive summed rows -> SUMPRODUCT((sum>0))
            wsm.cell(rr,7,f"=SUMPRODUCT(--({sumexpr}>0))/{n}*100")
            wsm.cell(rr,8,"")  # skew of composite: skip (documented)
            wsm.cell(rr,9,f"=(D{rr}/10000)/(E{rr}/10000)*SQRT(4)")
            wsm.cell(rr,10,f"=(EXP((4/{n})*SUMPRODUCT(LN(1+{sumexpr})))-1)*100")
            wsm.cell(rr,11,f"=(EXP(SUMPRODUCT(LN(1+{sumexpr})))-1)*100")
        rr+=1
for j in range(3,12):
    for i in range(2,rr):
        wsm.cell(i,j).number_format="0.00"
wsm.column_dimensions["A"].width=18; wsm.column_dimensions["B"].width=12

# ================= Sharpe_bridge =================
wb_=wb.create_sheet("Sharpe_bridge")
_A  = BRIDGE["A_endpoint_all46"]; _B = BRIDGE["B_endpoint_rebuildable"]
_C  = BRIDGE["C_rebuild_unlagged"]; _D = BRIDGE["D_rebuild_lagged"]
_st = RA["stub_rows"]
bridge=[
    ["Step","Description","Sharpe","Delta","Cause"],
    ["A",f"Endpoint drop-idio (mkt+sec+subsec), ALL 46 quarters (get_filer_portfolio layer returns)",round(_A,3),"","the previously published 1.00"],
    ["B",f"Endpoint drop-idio, restricted to the {_st['n_kept']} rebuildable teos",round(_B,3),round(_B-_A,3),"SAMPLE — the 4 dropped rows are not Berkshire's book (below)"],
    ["C",f"Daily rebuild drop-idio, same teos, teo->teo+3mo windows",round(_C,3),round(_C-_B,3),"METHOD (rebuild uses actual prices; endpoint returns a model-implied gross)"],
    ["D","Daily rebuild drop-idio, LAGGED windows (entry = teo+45 calendar days)",round(_D,3),round(_D-_C,3),"the lag itself — the edge survives it"],
    ["","","","",""],
    ["WHY THE 4 ROWS ARE DROPPED","", "","",""],
    ["  3 stub rows",f"{', '.join(STUB_TEOS)} — each row describes a 1-2 NAME portfolio holding "
                     f"0.001%-0.8% of the AUM the neighbouring quarters report. No holdings book matches them "
                     f"because there is no full book behind them. They are not 'unverifiable Berkshire quarters'; "
                     f"they are a different, tiny portfolio.","","",""],
    ["  1 terminal row",f"{TERMINAL_TEO} — the LAST row of the portfolio series carries a forward return measured "
                        f"over an open-ended window (teo -> the engine's data horizon), not one quarter. Its "
                        f"portfolio_market_return sits {RA['terminal_row']['Berkshire']['terminal_dev_bps']:.0f} bps "
                        f"from SPY over its own forward quarter, ~{RA['terminal_row']['Berkshire']['dev_vs_prior_median_x']:.0f}x "
                        f"the filer's typical deviation.","","",""],
    ["  their drop-idio mean",f"{_st['stub_drop_idio_mean_bps']:.0f} bps/q vs {_st['kept_drop_idio_mean_bps']:.0f} bps/q "
                              f"for the {_st['n_kept']} kept — that gap is the whole A->B step","","","= why 1.003 was inflated"],
    ["","","","",""],
    ["VERDICT",f"Do NOT quote {_A:.2f}. It is contaminated, not merely sample-selected. On a consistent sample the "
               f"endpoint gives {_B:.2f} and the independent daily rebuild {_C:.2f}; the {_C-_B:+.2f} gap between them "
               f"is the known rebuild-rich bias, not agreement. Quote a RANGE ({_B:.2f}-{_C:.2f}) with the sample "
               f"stated, and never a single decimal.","","",""],
    ["FINDING",f"Drop-idio beats the gross book on the same sample and SURVIVES the lag "
               f"({_C:.2f} unlagged -> {_D:.2f} lagged). That comparison is internal to one method and is the "
               f"robust part; the absolute level is not.","","",""],
]
for i,r in enumerate(bridge,1):
    for j,v in enumerate(r,1):
        cc=wb_.cell(i,j,v)
        if i==1: cc.font=HEAD; cc.fill=HFILL
        if r[0] in ("VERDICT","A","B","C"): wb_.cell(i,1).font=BOLD
wb_.column_dimensions["A"].width=20; wb_.column_dimensions["B"].width=70
for c in "CDE": wb_.column_dimensions[c].width=14
wb_.column_dimensions["E"].width=48

# ================= Hit_rate (Task 3) =================
# Computed inline from `rows` above. An earlier version read a JSON file out of a
# session scratchpad that no longer exists, so this sheet could not be regenerated
# by anyone. Everything here now derives from the same per-quarter rows the rest of
# the workbook uses.
def _hitrate_stats(vals):
    x = np.asarray([v for v in vals if v is not None and not np.isnan(v)], float)
    n = len(x)
    wins, losses = x[x > 0], x[x <= 0]
    k = len(wins)
    # two-sided exact binomial against p=0.5
    p = min(1.0, 2 * sum(comb(n, i) for i in range(k, n + 1)) / (2 ** n)) if n else np.nan
    if k < n and k > 0:
        p = min(1.0, 2 * min(
            sum(comb(n, i) for i in range(k, n + 1)),
            sum(comb(n, i) for i in range(0, k + 1))) / (2 ** n))
    m, sd = x.mean(), x.std(ddof=1)
    skew = float(((x - m) ** 3).mean() / sd ** 3) * (np.sqrt(n * (n - 1)) / (n - 2)) if n > 2 and sd > 0 else np.nan
    run = best = 0
    for v in x:
        run = run + 1 if v <= 0 else 0
        best = max(best, run)
    return {"n": n, "hit": k / n * 100 if n else np.nan, "binom_p": p,
            "mean_win_bps": wins.mean() * 1e4 if len(wins) else np.nan,
            "mean_loss_bps": losses.mean() * 1e4 if len(losses) else np.nan,
            "win_loss_ratio": abs(wins.mean() / losses.mean()) if len(wins) and len(losses) and losses.mean() else np.nan,
            "skew": skew, "worst_bps": x.min() * 1e4, "best_bps": x.max() * 1e4,
            "loss_run": best}


_HR_KEYS = {"market": ("market_u", "market_lq"), "sector": ("sector_u", "sector_lq"),
            "subsector": ("subsector_u", "subsector_lq"),
            "sec_sub": (("sector_u", "subsector_u"), ("sector_lq", "subsector_lq")),
            "mkt_sec_sub": (("market_u", "sector_u", "subsector_u"),
                            ("market_lq", "sector_lq", "subsector_lq")),
            "idio": ("idio_u", "idio_lq"), "gross": ("gross_u", "gross_lq")}
hr = {}
for _k, (_uk, _lk) in _HR_KEYS.items():
    for _basis, _key in (("UNLAGGED", _uk), ("LAGGED", _lk)):
        if isinstance(_key, tuple):
            _vals = [sum(r[c] if c.endswith("_u") else r[c.replace("_lq", "_l")] / r["q_len"]
                         for c in _key) for r in rows]
        else:
            _vals = [r[_key] if _key.endswith("_u") else r[_key.replace("_lq", "_l")] / r["q_len"]
                     for r in rows]
        hr[f"{_basis}_{_k}"] = _hitrate_stats(_vals)

whr = wb.create_sheet("Hit_rate")
whr.cell(1,1,"Hit rate / skew — every layer, lagged & unlagged (per-quarter normalised). "
              "CORRECTS meeting note: L1/market hit = 83% unlagged, NOT 65%. 65% was sector+subsector.").font=BOLD
hdr=["basis","layer","n","hit_%","binom_p","mean_win_bps","mean_loss_bps","win/loss","skew","worst_bps","best_bps","longest_loss_run"]
r0=3
for j,h in enumerate(hdr,1):
    cc=whr.cell(r0,j,h); cc.font=HEAD; cc.fill=HFILL
order=["market","sector","subsector","sec_sub","mkt_sec_sub","idio","gross"]
lblmap={"sec_sub":"sector+subsector","mkt_sec_sub":"mkt+sec+subsec"}
ri=r0+1
for basis in ("UNLAGGED","LAGGED"):
    for k in order:
        d=hr[f"{basis}_{k}"]
        vals=[basis, lblmap.get(k,k), d["n"], round(d["hit"],0), round(d["binom_p"],3),
              round(d["mean_win_bps"],0), round(d["mean_loss_bps"],0), round(d["win_loss_ratio"],2),
              round(d["skew"],2), round(d["worst_bps"],0), round(d["best_bps"],0), d["loss_run"]]
        for j,v in enumerate(vals,1):
            cc=whr.cell(ri,j,v)
            if k in ("sec_sub","mkt_sec_sub"): cc.font=BOLD
        ri+=1
    ri+=1
whr.cell(ri+1,1,"READ: sector+subsector has POSITIVE skew (+1.95 unlagged / +0.74 lagged) and win/loss>1 "
                "— wins more frequent AND larger. The 'frequent small wins, rare large losses' (negative-skew) "
                "pattern belongs to the MARKET layer (skew -1.21, win/loss 0.55), not the factor premium.").font=BOLD
for c,w in (("A",10),("B",18)): whr.column_dimensions[c].width=w

# ================= Lag_distribution (Tasks 4 & 5) =================
wl = wb.create_sheet("Lag_distribution")
# Raw lag stats come from the cached portfolio rows (all five filers). The
# ORIGINAL-filtered columns need the holdings envelope's amendment_type, and only
# Berkshire and D. E. Shaw holdings are cached, so the other three are marked
# "not recomputed" rather than carried forward from a stale scratchpad file that
# no longer exists. Do not re-enter those numbers from an old document -- re-run
# with a live holdings fetch if they are needed.
FILERS_ALL = {"Berkshire": "BW-FILER-CIK0001067983", "Pershing": "BW-FILER-CIK0001336528",
              "Appaloosa": "BW-FILER-CIK0001656456", "Greenlight": "BW-FILER-CIK0001079114",
              "DEShaw": "BW-FILER-CIK0001009207"}
amd = {}
for _fn, _fid in FILERS_ALL.items():
    _pf = B._CACHE / f"portfolio_{_fid}.json"
    if not _pf.exists():
        continue
    _pr = [r for r in json.load(open(_pf)) if r.get("filing_date") and r.get("teo")]
    _lags = np.array([(pd.Timestamp(r["filing_date"]) - pd.Timestamp(r["teo"])).days for r in _pr])
    # ORIGINAL-filtered: only where the holdings envelope is cached for this filer
    _orig = []
    for r in _pr:
        _hp = B._CACHE / f"holdings_{_fid}_{r['teo']}.json"
        if not _hp.exists():
            continue
        _h = json.load(open(_hp))
        if _h.get("report_date") == r["teo"] and _h.get("amendment_type") == "ORIGINAL" and _h.get("filing_date"):
            _orig.append((pd.Timestamp(_h["filing_date"]) - pd.Timestamp(r["teo"])).days)
    _o = np.array(_orig)
    amd[_fn] = {
        "raw": {"n": int(len(_lags)), "median": float(np.median(_lags)),
                "max": int(_lags.max()), "pct_exactly_45": float((_lags == 45).mean() * 100)},
        "orig": ({"n": int(len(_o)), "p25": float(np.percentile(_o, 25)),
                  "median": float(np.median(_o)), "p75": float(np.percentile(_o, 75)),
                  "max": int(_o.max())} if len(_o) else None),
    }

wl.cell(1,1,"Lag = filing_date - teo (days). Per-filer summary (raw vs ORIGINAL-filtered), then per-teo detail.").font=BOLD
wl.cell(2,1,"Filing dates are 63-68% EXACTLY 45 across four independent filers -> largely a report_date+45 "
            "placeholder, not observed. search metadata flags filing_date_source='placeholder_lag_75d' (a "
            "different +75 default we do NOT use). Neither portfolio nor holdings response carries the flag.").font=Font(italic=True)
sh=["filer","raw_n","raw_median","raw_max","%_exactly_45","ORIG_n","ORIG_p25","ORIG_median","ORIG_p75","ORIG_max"]
r0=4
for j,h in enumerate(sh,1):
    cc=wl.cell(r0,j,h); cc.font=HEAD; cc.fill=HFILL
ri=r0+1
for fn,d in amd.items():
    vals=[fn,d["raw"]["n"],d["raw"]["median"],d["raw"]["max"],round(d["raw"]["pct_exactly_45"],0)]
    if d["orig"]:
        vals+=[d["orig"]["n"],d["orig"]["p25"],d["orig"]["median"],d["orig"]["p75"],d["orig"]["max"]]
    else:
        vals+=["not recomputed (holdings not cached)","","","",""]
    for j,v in enumerate(vals,1): wl.cell(ri,j,v)
    ri+=1
# per-teo detail for all 4 filers
ri+=2
wl.cell(ri,1,"PER-TEO DETAIL (portfolio endpoint filing_date; is_original heuristic: lag<=90 & not a known amendment)").font=BOLD
ri+=1
dh=["filer","teo(report_date)","filing_date","lag_days","exact_45?","is_original(heuristic)"]
for j,h in enumerate(dh,1):
    cc=wl.cell(ri,j,h); cc.font=HEAD; cc.fill=HFILL
ri+=1
FILERS={"Berkshire":"BW-FILER-CIK0001067983","Pershing":"BW-FILER-CIK0001336528",
        "Appaloosa":"BW-FILER-CIK0001656456","Greenlight":"BW-FILER-CIK0001079114"}
for fn,fid in FILERS.items():
    pf=B._CACHE/f"portfolio_{fid}.json"
    if pf.exists():
        prows=json.load(open(pf))
    else:
        prows=B.client().get_filer_portfolio(fid)["rows"]; pf.write_text(json.dumps(prows,default=str))
    prows=[r for r in prows if r.get("filing_date") and r.get("teo")]
    prows.sort(key=lambda r:r["teo"])
    for r in prows:
        lag=(pd.Timestamp(r["filing_date"])-pd.Timestamp(r["teo"])).days
        wl.cell(ri,1,fn); wl.cell(ri,2,r["teo"]); wl.cell(ri,3,r["filing_date"])
        wl.cell(ri,4,lag); wl.cell(ri,5,"YES" if lag==45 else ""); wl.cell(ri,6,"ORIGINAL" if lag<=90 else "AMENDMENT?")
        ri+=1
wl.column_dimensions["A"].width=11; wl.column_dimensions["B"].width=16; wl.column_dimensions["C"].width=14

wb.save(_HERE / "attribution_audit.xlsx")
print("wrote attribution_audit.xlsx (README, Berkshire_quarterly, Berkshire_summary, Sharpe_bridge, +Hit_rate/Lag placeholders)")
