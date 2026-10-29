#!/usr/bin/env python3
"""Build the month-end exposure panel behind POST /api/portfolio/exposure/history.

Reads the ERM3 hedge-weights, returns and ETF Zarr stores and writes one small
store with each name's model values on the last trading day of every month,
plus the ETF covariance matrix (252 trading days) at each month-end.

See docs/EXPOSURE_HISTORY_FEED.md. Everything written is derived data; no raw
prices or return series are copied.

Production producer is ERM3, not this script (ERM3-75 increment 5): the
pipeline builds ds_exposure_month_end_* (erm3/io/exposure_panel.py, asset
build_exposure_month_end_panel, exposure_panel.enable) before output_gate,
and sync_to_gcs publishes it with the rest of the release (it is in
published_zarr_names). A copy written here into the publish prefix was
overwritten by the next publish, and under release slots it would never
reach the slot the API reads. So this script refuses any output under the
publish layout (always rm_api_data/eodhd, plus the ZARR_GCS_PREFIX base when
set; including slots/ and CURRENT) and is a local / scratch tool only.

Usage:
    python scripts/build_exposure_month_end_panel.py --out ./ds_exposure_month_end_SPY_uni_mc_3000.zarr
    python scripts/build_exposure_month_end_panel.py --src ./zarr/eodhd --out /tmp/panel.zarr

Requires xarray, zarr<3, gcsfs, numpy, pandas.
"""

from __future__ import annotations

import argparse
import sys
import time

import numpy as np
import pandas as pd
import xarray as xr

DEFAULT_SRC = "gs://rm_api_data/eodhd"
DEFAULT_PUBLISH_BASE = "rm_api_data/eodhd"   # lib/zarr-config.ts parseZarrGcsPrefix default
FACTOR_SET = "SPY_uni_mc_3000"

# panel variable -> (store, source variable)
HEDGE_VARS = {
    "l1_mkt_hr": "L1_market_HR",
    "l2_mkt_hr": "L2_market_HR",
    "l2_sec_hr": "L2_sector_HR",
    "l3_mkt_hr": "L3_market_HR",
    "l3_sec_hr": "L3_sector_HR",
    "l3_sub_hr": "L3_subsector_HR",
    "l1_res_er": "L1_residual_ER",
    "l2_res_er": "L2_residual_ER",
    "l3_res_er": "L3_residual_ER",
    "l3_mkt_er": "L3_market_ER",
    "l3_sec_er": "L3_sector_ER",
    "l3_sub_er": "L3_subsector_ER",
    "stock_var": "_stock_var",
}
RETURNS_VARS = {"lstar_level": "lstar_level"}

COV_WINDOW = 252
SYMBOL_CHUNK = 1024
START = "2006-01-01"


def month_end_teos(teo: pd.DatetimeIndex) -> pd.DatetimeIndex:
    """Last trading day present in the store for each calendar month."""
    s = pd.Series(teo, index=teo)
    last = s.groupby([teo.year, teo.month]).max()
    return pd.DatetimeIndex(sorted(last.values))


def etf_covariances(etf: xr.Dataset, months: pd.DatetimeIndex) -> tuple[np.ndarray, list[str], np.ndarray]:
    """(month, etf, etf) sample covariance over the 252 trading days ending each month-end.

    An ETF with any missing day in a window is NaN for that month (row and column);
    nothing is filled.
    """
    tickers = [str(t).strip() for t in etf["ticker"].values]
    teo = pd.DatetimeIndex(etf["teo"].values)
    ret = np.asarray(etf["return"].values, dtype=np.float64)  # (teo, etf)
    n_etf = len(tickers)
    out = np.full((len(months), n_etf, n_etf), np.nan, dtype=np.float32)
    obs = np.zeros(len(months), dtype=np.int32)
    for m, me in enumerate(months):
        end = teo.searchsorted(me, side="right")
        start = end - COV_WINDOW
        if start < 0:
            continue
        window = ret[start:end]
        ok = np.isfinite(window).all(axis=0)
        if ok.sum() == 0:
            continue
        sub = window[:, ok]
        c = np.cov(sub, rowvar=False, ddof=1)
        idx = np.where(ok)[0]
        out[m][np.ix_(idx, idx)] = c.astype(np.float32)
        obs[m] = COV_WINDOW
    return out, tickers, obs


def publish_layout_violation(out: str, publish_base: str | None = None) -> str | None:
    """Why ``out`` must not be written (it is inside an ERM3 publish layout), or None when it may be.

    Guarded bases: the production default rm_api_data/eodhd ALWAYS, plus ``publish_base`` or env
    ZARR_GCS_PREFIX when set (a staging layout). Pointing ZARR_GCS_PREFIX elsewhere never unguards production.
    Anything under a guarded base -- the fixed prefix, slots/a, slots/b -- is written only by ERM3's sync_to_gcs.
    """
    import os

    bases = {DEFAULT_PUBLISH_BASE}
    extra = publish_base or os.environ.get("ZARR_GCS_PREFIX")
    if extra:
        bases.add(extra)
    target = out.strip()
    if not target.startswith("gs://"):
        return None
    path = target[len("gs://"):].strip("/")
    for raw in sorted(bases):
        base = raw.strip().removeprefix("gs://").strip("/")
        if base and (path == base or path.startswith(base + "/")):
            return (
                f"refusing to write {out}: gs://{base}/ is an ERM3 publish layout. ds_exposure_month_end_* is "
                "built by the ERM3 pipeline (build_exposure_month_end_panel) and published by sync_to_gcs; "
                "a copy written here is overwritten by the next publish and, under release slots, never reaches "
                "the slot the API reads. Write to a local path or a scratch prefix instead."
            )
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--src", default=DEFAULT_SRC, help="directory holding the ERM3 stores")
    ap.add_argument("--factor-set", default=FACTOR_SET)
    ap.add_argument("--out", required=True, help="output store path (local or gs://)")
    args = ap.parse_args()
    why = publish_layout_violation(args.out)
    if why:
        print(why, file=sys.stderr)
        return 2

    t0 = time.time()
    hedge = xr.open_zarr(f"{args.src}/ds_erm3_hedge_weights_{args.factor_set}.zarr")
    rets = xr.open_zarr(f"{args.src}/ds_erm3_returns_{args.factor_set}.zarr")
    etf = xr.open_zarr(f"{args.src}/ds_etf.zarr")

    teo = pd.DatetimeIndex(hedge["teo"].values)
    months = month_end_teos(teo[teo >= START])
    print(f"{len(months)} month-ends {months[0].date()} .. {months[-1].date()}", flush=True)

    symbols = np.asarray(hedge["symbol"].values).astype(str)
    data_vars: dict[str, tuple] = {}
    for name, src in HEDGE_VARS.items():
        arr = hedge[src].sel(teo=months).values.astype(np.float32)
        data_vars[name] = (("teo", "symbol"), arr)
        print(f"  {name:<12} from hedge.{src}  ({time.time() - t0:.0f}s)", flush=True)

    # lstar_level lives in the returns store; align on symbol, 0 = no recommendation.
    r_sym = np.asarray(rets["symbol"].values).astype(str)
    r_months = rets["lstar_level"].sel(teo=months).values.astype(np.float32)
    pos = pd.Index(r_sym).get_indexer(symbols)
    lstar = np.full((len(months), len(symbols)), np.nan, dtype=np.float32)
    have = pos >= 0
    lstar[:, have] = r_months[:, pos[have]]
    lstar[lstar == 0] = np.nan
    data_vars["lstar_level"] = (("teo", "symbol"), lstar)
    print(f"  lstar_level  from returns.lstar_level  ({time.time() - t0:.0f}s)", flush=True)

    cov, etf_tickers, cov_obs = etf_covariances(etf, months)
    data_vars["etf_cov"] = (("teo", "etf", "etf_j"), cov)
    data_vars["etf_cov_obs"] = (("teo",), cov_obs)
    print(f"  etf_cov      {len(etf_tickers)} ETFs  ({time.time() - t0:.0f}s)", flush=True)

    ds = xr.Dataset(
        data_vars,
        coords={
            # "teo" holds month-end trading days (same name as the daily stores so
            # the API reader decodes it with the shared helper).
            "teo": months.values,
            "symbol": symbols,
            "ticker": ("symbol", np.asarray(hedge["ticker"].values).astype(str)),
            "etf": etf_tickers,
            "etf_j": etf_tickers,
        },
        attrs={
            "description": "Month-end ERM3 exposure panel for /api/portfolio/exposure/history (derived data only).",
            "factor_set": args.factor_set,
            "cov_window_trading_days": COV_WINDOW,
            "l1_mkt_beta": "not stored; equals -l1_mkt_hr exactly (L1 = SPY only)",
            "built_utc": pd.Timestamp.utcnow().isoformat(),
            "source_last_teo": str(teo[-1].date()),
        },
    )
    enc = {
        v: {"chunks": (len(months), min(SYMBOL_CHUNK, len(symbols)))}
        for v in list(HEDGE_VARS) + ["lstar_level"]
    }
    enc["etf_cov"] = {"chunks": (len(months), len(etf_tickers), len(etf_tickers))}
    ds.to_zarr(args.out, mode="w", encoding=enc, consolidated=True, zarr_format=2)
    print(f"wrote {args.out} in {time.time() - t0:.0f}s", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
