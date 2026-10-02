"""One decompose fan-out per filer capturing per-position risk detail for D2 + D3.

For each of the four filers, decompose every disclosed position once and cache:
  - dollars, weight
  - sector_etf  (exposure.sector.hedge_etf,  e.g. XLK)
  - subsector_etf (exposure.subsector.hedge_etf, e.g. RSPT)
  - L3 ER shares: {market_er, sector_er, subsector_er, residual_er}
    These sum to ~1.0 per position (verified: AAPL 0.2268+0.0087+0.0057+0.7588=1.0),
    i.e. each layer's share of the position's total (a clean variance-style split).

Consumers:
  - D2 risk_decomposition_stacked.py — dollar-weighted mean of the L3 ER shares per filer.
  - D3 long_etf_explainer.py         — book sector weights via sector_etf grouping.

Cached to charts/risk_detail.json. Run:
  python sdk/portfolio_timeseries/compute_risk_detail.py
"""

from __future__ import annotations

# --- import-order shim -------------------------------------------------------
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
ER_KEYS = ("market_er", "sector_er", "subsector_er", "residual_er")

FILERS = {
    "Berkshire": "BW-FILER-CIK0001067983",
    "Pershing": "BW-FILER-CIK0001336528",
    "Appaloosa": "BW-FILER-CIK0001656456",
    "Greenlight": "BW-FILER-CIK0001079114",
}


def compute(client, name, fid):
    pts = PortfolioTimeSeries.from_cik(fid, client=client)
    snap = pts.as_of(date.today())
    tickers = [str(t) for t in snap["ticker"].values]
    dollars = np.asarray(snap["dollars"].values, dtype=float)
    gross = float(np.nansum(dollars))

    positions = []
    n_dec = 0
    for tkr, d in zip(tickers, dollars):
        if np.isnan(d) or not tkr or tkr.startswith("BW-"):
            positions.append({"ticker": tkr, "dollars": None, "decomposed": False})
            continue
        try:
            dec = client.decompose(tkr)
        except Exception as e:  # noqa: BLE001
            positions.append({"ticker": tkr, "dollars": float(d),
                              "decomposed": False, "error": f"{type(e).__name__}"})
            continue
        n_dec += 1
        exp = dec.get("exposure", {}) or {}
        l3 = ((dec.get("hedge_levels", {}) or {}).get("L3", {}) or {})
        rec = {
            "ticker": tkr, "dollars": float(d), "decomposed": True,
            "sector_etf": (exp.get("sector", {}) or {}).get("hedge_etf"),
            "subsector_etf": (exp.get("subsector", {}) or {}).get("hedge_etf"),
        }
        for k in ER_KEYS:
            v = l3.get(k)
            rec[k] = float(v) if v is not None else None
        positions.append(rec)

    return {
        "name": name, "bw_filer_id": fid,
        "report_date": str(snap["report_date"].values)[:10],
        "gross_long": gross, "n_positions": len(tickers), "n_decomposed": n_dec,
        "positions": positions,
    }


def main():
    client = riskmodels.RiskModelsClient.from_env()
    print("riskmodels", riskmodels.__version__)
    out = {}
    for name, fid in FILERS.items():
        print("=" * 60, "\n", name)
        rec = compute(client, name, fid)
        out[name] = rec
        # quick sanity: dollar-weighted ER split
        w, agg = 0.0, {k: 0.0 for k in ER_KEYS}
        for p in rec["positions"]:
            if p.get("decomposed") and p.get("dollars") and p.get("market_er") is not None:
                w += p["dollars"]
                for k in ER_KEYS:
                    agg[k] += p["dollars"] * (p[k] or 0.0)
        if w:
            print("  dollar-wtd ER split:", {k: round(agg[k] / w, 3) for k in ER_KEYS})
        print(f"  n_decomposed={rec['n_decomposed']}/{rec['n_positions']}")
    (_HERE / "charts").mkdir(exist_ok=True)
    (_HERE / "charts" / "risk_detail.json").write_text(json.dumps(out, indent=2, default=str))
    print("[written] charts/risk_detail.json")


if __name__ == "__main__":
    main()
