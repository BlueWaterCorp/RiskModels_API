"""Deliverable 1 — wire Appaloosa + Greenlight and report snapshot/concentration.

Resolves each filer (with the alternate CIKs / name searches from the plan), loads
the current snapshot via PortfolioTimeSeries.from_cik, prints top-10 positions and
concentration (HHI / top-5 / top-10). Writes a compact JSON to charts/ so the
downstream concentration chart can reuse it without re-hitting the API.

Run:  python sdk/portfolio_timeseries/wire_filers.py
"""

from __future__ import annotations

# --- import-order shim: pip 0.3.11 before local sdk/ shadows it --------------
import riskmodels  # noqa: E402
import sys
from pathlib import Path

_SDK = str(Path(__file__).resolve().parents[1])
if _SDK not in sys.path:
    sys.path.insert(0, _SDK)
# -----------------------------------------------------------------------------

import json
from datetime import date

import numpy as np

from portfolio_timeseries import PortfolioTimeSeries

_HERE = Path(__file__).parent

# Each entry: display name -> list of resolution attempts (CIK or {"name": ...}).
# NOTE: search_filers does NOT match a zero-padded CIK string, so we resolve a CIK
# by the deterministic BW-FILER-CIK{zfill(10)} id (verified via get_filer) and only
# fall back to name search. Working ids are listed first.
FILERS = {
    "Berkshire": ["0001067983"],
    "Pershing": ["0001336528"],
    "Appaloosa": ["0001656456", "0001006438", {"name": "Appaloosa"}],
    "Greenlight": ["0001079114", "0001522887", "0001080124", {"name": "Greenlight Capital"}],
}


def _resolve(client, attempts):
    """Return (bw_filer_id, meta) for the first attempt that resolves, else (None, notes)."""
    notes = []
    for a in attempts:
        try:
            if isinstance(a, dict):  # name search
                res = client.search_filers(q=a["name"], limit=5)
                results = res.get("results") or res.get("filers") or []
                token = a["name"].split()[0].lower()
                for it in results:  # prefer a name that actually contains the token
                    if token in str(it.get("name", "")).lower():
                        return it.get("bw_filer_id"), it
                if results:
                    return results[0].get("bw_filer_id"), results[0]
                notes.append(f"name {a['name']!r}: 0 results")
            else:  # CIK -> deterministic BW-FILER id, confirmed via get_filer
                fid = f"BW-FILER-CIK{str(a).zfill(10)}"
                meta = client.get_filer(fid)  # raises APIError if not found
                return fid, meta
        except Exception as e:  # noqa: BLE001
            notes.append(f"{a}: {type(e).__name__}: {str(e)[:50]}")
    return None, notes


def wire(client, name, attempts):
    fid, meta = _resolve(client, attempts)
    if fid is None:
        print(f"[{name}] UNRESOLVED after {len(attempts)} attempts: {meta}")
        return None
    print(f"[{name}] resolved -> {fid}  ({meta.get('name')}, latest {meta.get('latest_report_date')})")

    pts = PortfolioTimeSeries.from_cik(fid, client=client)
    snap = pts.as_of(date.today())
    if snap["dollars"].size == 0:
        print(f"[{name}] empty snapshot")
        return None

    tickers = [str(t) for t in snap["ticker"].values]
    dollars = np.asarray(snap["dollars"].values, dtype=float)
    weights = np.asarray(snap["weight"].values, dtype=float)
    w = np.where(np.isnan(weights), 0.0, weights)
    order = np.argsort(w)[::-1]

    report = str(snap["report_date"].values)[:10]
    gross = float(np.nansum(dollars))
    hhi = pts.concentration("hhi")
    top5 = pts.concentration("top_n", 5)
    top10 = pts.concentration("top_n", 10)

    print(f"  report={report}  n={len(tickers)}  gross(adj_mv)={gross:,.0f}")
    print(f"  HHI={hhi:.4f}  top5={top5:.1%}  top10={top10:.1%}")
    print("  top-10:")
    top = []
    for i in order[:10]:
        print(f"    {tickers[i]:8s} {w[i]:.2%}")
        top.append({"ticker": tickers[i], "weight": float(w[i])})

    return {
        "name": name, "bw_filer_id": fid, "cik": meta.get("cik"),
        "report_date": report, "n_holdings": len(tickers),
        "gross_adj_mv": gross, "hhi": hhi, "top5": top5, "top10": top10,
        "top10_positions": top,
        "latest_report_date": meta.get("latest_report_date"),
        "aum_tier": meta.get("aum_tier"),
    }


def main():
    client = riskmodels.RiskModelsClient.from_env()
    print("riskmodels", riskmodels.__version__)
    out = {}
    for name, attempts in FILERS.items():
        print("=" * 68)
        rec = wire(client, name, attempts)
        if rec:
            out[name] = rec
    (_HERE / "charts" / "filer_data.json").parent.mkdir(parents=True, exist_ok=True)
    (_HERE / "charts" / "filer_data.json").write_text(json.dumps(out, indent=2, default=str))
    print("=" * 68)
    print("RESOLVED:", list(out.keys()))
    print("[written] charts/filer_data.json")


if __name__ == "__main__":
    main()
