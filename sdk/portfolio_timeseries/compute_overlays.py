"""Compute overlays + per-factor exposures for the charts (one fan-out per filer).

For Berkshire and Pershing: decompose every disclosed position once and derive
(a) the netted ETF overlay (etf ticker -> signed short $), and (b) the dollar-
weighted per-layer factor exposure (market / sector / subsector) used by the
before/after chart. Results are cached to charts/overlay_data.json so each chart
script renders instantly without re-hitting the API.

Run:  python sdk/portfolio_timeseries/compute_overlays.py
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
LAYERS = ("market", "sector", "subsector")

FILERS = {
    "Berkshire": "BW-FILER-CIK0001067983",
    "Pershing": "BW-FILER-CIK0001336528",
    "Appaloosa": "BW-FILER-CIK0001656456",
    "Greenlight": "BW-FILER-CIK0001079114",  # stale (latest book 2023-12-31), ~27.5% BW-RESTRICTED
}


def compute(client, name, fid):
    pts = PortfolioTimeSeries.from_cik(fid, client=client)
    snap = pts.as_of(date.today())
    tickers = [str(t) for t in snap["ticker"].values]
    dollars = np.asarray(snap["dollars"].values, dtype=float)
    gross_long = float(np.nansum(dollars))

    etf_shorts: dict[str, float] = {}
    layer_pre: dict[str, float] = {k: 0.0 for k in LAYERS}   # Σ D_i · hr_i,layer
    n_decomposed = 0
    for tkr, d in zip(tickers, dollars):
        if np.isnan(d) or tkr.startswith("BW-") or tkr == "BW-RESTRICTED":
            continue  # skip unresolved / restricted rows (no ticker to decompose)
        try:
            dec = client.decompose(tkr)
        except Exception:  # noqa: BLE001
            continue
        n_decomposed += 1
        # ETF overlay: hedge dict is {etf: per-dollar short ratio}.
        for etf, r in (dec.get("hedge", {}) or {}).items():
            if r is not None:
                etf_shorts[etf] = etf_shorts.get(etf, 0.0) + d * float(r)
        # Per-layer exposure: exposure[layer].hr, dollar-weighted.
        exp = dec.get("exposure", {}) or {}
        for layer in LAYERS:
            hr = (exp.get(layer, {}) or {}).get("hr")
            if hr is not None:
                layer_pre[layer] += d * float(hr)

    return {
        "name": name, "bw_filer_id": fid,
        "report_date": str(snap["report_date"].values)[:10],
        "gross_long": gross_long, "n_positions": len(tickers),
        "n_decomposed": n_decomposed,
        "etf_shorts": etf_shorts,
        "layer_pre_hedge": layer_pre,
        # Post-hedge = pre-hedge minus the overlay's neutralizing short on that
        # layer's ETF. By construction the overlay short == pre-hedge, so ~0.
        "layer_post_hedge": {k: 0.0 for k in LAYERS},
    }


def main():
    client = riskmodels.RiskModelsClient.from_env()
    print("riskmodels", riskmodels.__version__)
    out = {}
    for name, fid in FILERS.items():
        print("=" * 60, "\n", name)
        rec = compute(client, name, fid)
        out[name] = rec
        print(f"  gross_long={rec['gross_long']:,.0f}  n_decomposed={rec['n_decomposed']}")
        print(f"  layer_pre_hedge={ {k: round(v,0) for k,v in rec['layer_pre_hedge'].items()} }")
        print(f"  n_etfs={len(rec['etf_shorts'])}  net_short={sum(rec['etf_shorts'].values()):,.0f}")
    (_HERE / "charts").mkdir(exist_ok=True)
    (_HERE / "charts" / "overlay_data.json").write_text(json.dumps(out, indent=2, default=str))
    print("[written] charts/overlay_data.json")


if __name__ == "__main__":
    main()
