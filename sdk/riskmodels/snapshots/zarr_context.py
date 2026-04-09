"""Build :class:`StockContext` from local ERM3 zarr (same shape as API ``fetch_stock_context``).

Use :func:`build_p1_from_zarr` so :class:`P1Data` is assembled only via
:func:`riskmodels.snapshots.p1_stock_performance.build_p1_data_from_stock_context`
— the same tail/cum/l3_er rules as production, plus rankings and macro correlations
from zarr (``ds_rankings_*``, ``ds_macro_factor.zarr``). Gold is not in
``ds_macro_factor``; that slot stays empty unless you supply API macro later.
"""

from __future__ import annotations

import math
import os
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .p1_stock_performance import P1Data

import numpy as np
import pandas as pd
import xarray as xr

from ._data import StockContext


def _riskmodels_repo_root() -> Path:
    """``sdk/riskmodels/snapshots/zarr_context.py`` → RiskModels_API repo root."""
    return Path(__file__).resolve().parents[3]


def _default_erm3_root() -> Path:
    """Prefer ``ERM3_ROOT``; else sibling ``../ERM3`` from this repo (no home-dir defaults)."""
    if os.environ.get("ERM3_ROOT"):
        return Path(os.environ["ERM3_ROOT"])
    return _riskmodels_repo_root().parent / "ERM3"


def _default_zarr_root() -> Path:
    """Prefer ``ERM3_ZARR_ROOT``; else ``<ERM3>/data/stock_data/zarr/eodhd``."""
    if os.environ.get("ERM3_ZARR_ROOT"):
        return Path(os.environ["ERM3_ZARR_ROOT"])
    return _default_erm3_root() / "data" / "stock_data" / "zarr" / "eodhd"


_DEFAULT_ZARR = _default_zarr_root()
_DEFAULT_ERM3 = _default_erm3_root()

# Company name lookup (cached on first call)
_TICKER_TO_NAME: dict[str, str] | None = None


def _resolve_company_name_local(ticker: str, erm3_root: Path | None = None) -> str:
    """Look up company name from the EODHD ticker_list CSV. Falls back to ticker."""
    global _TICKER_TO_NAME
    if _TICKER_TO_NAME is None:
        root = erm3_root or _DEFAULT_ERM3
        csv_path = root / "data" / "stock_data" / "eodhd" / "csv" / "ticker_list.csv"
        _TICKER_TO_NAME = {}
        if csv_path.exists():
            try:
                df = pd.read_csv(csv_path, usecols=["ticker", "name"])
                for _, row in df.iterrows():
                    t = str(row.get("ticker", "")).upper()
                    n = str(row.get("name", ""))
                    if t and n:
                        _TICKER_TO_NAME[t] = n
            except Exception:
                pass
    return _TICKER_TO_NAME.get(ticker.upper(), ticker)

BW_SECTOR_TO_ETF = {
    1: "XLE",
    2: "XLB",
    3: "XLI",
    4: "XLY",
    5: "XLP",
    6: "XLV",
    7: "XLF",
    8: "XLK",
    9: "XLC",
    10: "XLU",
    11: "XLRE",
}


def _ensure_erm3_import(erm3_root: Path) -> None:
    if str(erm3_root) not in sys.path:
        sys.path.insert(0, str(erm3_root))


def _subsector_etf(fs_industry: float | int | None, erm3_root: Path) -> str | None:
    _ensure_erm3_import(erm3_root)
    from erm3.shared.etf_register import FS_INDUSTRY_TO_SUBSECTOR_ETFS
    if fs_industry is None:
        return None
    try:
        ind = int(fs_industry)
    except (TypeError, ValueError):
        return None
    etfs = FS_INDUSTRY_TO_SUBSECTOR_ETFS.get(ind, [])
    return str(etfs[0]) if etfs else None


def _sector_etf(bw_code: float | int | None) -> str | None:
    if bw_code is None:
        return None
    try:
        return BW_SECTOR_TO_ETF.get(int(bw_code))
    except (TypeError, ValueError):
        return None


def _symbol_for_ticker(ds: xr.Dataset, ticker: str) -> str:
    """Resolve ticker to symbol using the dataset's ticker coordinate.

    Falls back to matching by symbol substring if the ticker coordinate is
    unpopulated (e.g. ds_erm3 where ticker coord may be 'None').
    """
    if "ticker" in ds.coords:
        tick = ds["ticker"].values.astype(str)
        idx = np.where(tick == ticker.upper())[0]
        if len(idx):
            return str(ds["symbol"].values[int(idx[0])])
    raise ValueError(f"No symbol for ticker {ticker} in {list(ds.dims)}")


def _etf_symbol(ds_etf: xr.Dataset, etf_ticker: str) -> str:
    tick = ds_etf["ticker"].values.astype(str)
    idx = np.where(tick == etf_ticker.upper())[0]
    if not len(idx):
        raise ValueError(f"ETF {etf_ticker} not in ds_etf")
    return str(ds_etf["symbol"].values[int(idx[0])])


def _df_from_etf_slice(ds_etf: xr.Dataset, etf_sym: str, n_days: int) -> pd.DataFrame:
    sub = ds_etf.sel(symbol=etf_sym).isel(teo=slice(-n_days, None))
    return _df_from_etf_slice_indexed(sub)


def _df_from_etf_slice_indexed(sub: xr.Dataset) -> pd.DataFrame:
    """Convert a pre-sliced ETF dataset to the snapshot DataFrame format."""
    df = sub.to_dataframe().reset_index()
    df["date"] = pd.to_datetime(df["teo"]).dt.strftime("%Y-%m-%d")
    df = df.rename(columns={"return": "returns_gross", "close": "price_close"})
    df["returns_gross"] = pd.to_numeric(df["returns_gross"], errors="coerce").fillna(0.0)
    return df[["date", "returns_gross", "price_close"]]


def _rankings_dict_from_zarr(
    ds_rank: xr.Dataset,
    sym: str,
    teo_coord: np.datetime64,
) -> dict[str, Any]:
    rankings: dict[str, Any] = {}
    for w in (1, 21, 63, 252):
        for suffix, z_suf in (
            ("gross_return", "gross_return"),
            ("subsector_residual", "subsector_residual"),
        ):
            ro = f"rank_ord_{w}d_subsector_{z_suf}"
            cs = f"cohort_size_{w}d_subsector_{z_suf}"
            if ro not in ds_rank.data_vars:
                continue
            c_f: float | None = None
            pct: float | None = None
            try:
                rv = ds_rank[ro].sel(symbol=sym, teo=teo_coord).values
                cv = ds_rank[cs].sel(symbol=sym, teo=teo_coord).values
                r_f = float(rv)
                c_f = float(cv)
                pct = (1.0 - r_f / c_f) if c_f > 0 else None
            except Exception:
                pass
            key = f"{w}d_subsector_{suffix}"
            rankings[key] = {
                "rank_ordinal": r_f,
                "cohort_size": c_f,
                "rank_percentile": pct * 100.0 if pct is not None else None,
                "metric": suffix,
                "cohort": "subsector",
                "window": f"{w}d",
            }
    return rankings


# Deep Dive / P1 macro block keys (``stock_deep_dive.MACRO_KEYS``)
_DD_MACRO_KEYS: tuple[str, ...] = ("vix", "oil", "gold", "bitcoin", "dxy", "ust10y2y")

# ERM3 ``ds_macro_factor`` coordinate ``factor`` → DD/API macro key
_ZARR_FACTOR_TO_DD_KEY: dict[str, str] = {
    "vix_spot": "vix",
    "oil": "oil",
    "bitcoin": "bitcoin",
    "usd": "dxy",
    "term_spread": "ust10y2y",
}


def _macro_correlations_from_zarr(
    merged: xr.Dataset,
    hist: pd.DataFrame,
    zarr_root: Path,
    *,
    windows: tuple[int, ...] = (252, 126, 63),
    min_overlap: int = 20,
) -> tuple[dict[str, float | None], str]:
    """Pearson corr(L3 residual daily return, macro factor return) on aligned ``teo`` rows.

    Mirrors the API fallback chain (try 252d, then 126d, 63d). Residual return matches
    :func:`build_p1_data_from_stock_context` (gross minus L3 HR × gross for mkt/sec/sub).
    """
    macro_z = zarr_root / "ds_macro_factor.zarr"
    if not macro_z.is_dir():
        return {k: None for k in _DD_MACRO_KEYS}, "252d"

    try:
        ds_m = xr.open_zarr(macro_z, consolidated=True)
    except Exception:
        return {k: None for k in _DD_MACRO_KEYS}, "252d"

    if "teo" in hist.columns:
        teo_dt = pd.to_datetime(hist["teo"])
    else:
        teo_dt = pd.to_datetime(merged.teo.values)

    ret = pd.to_numeric(hist["returns_gross"], errors="coerce").to_numpy(dtype=float)
    mkt = pd.to_numeric(hist["l3_market_er"], errors="coerce").to_numpy(dtype=float)
    sec = pd.to_numeric(hist["l3_sector_er"], errors="coerce").to_numpy(dtype=float)
    sub = pd.to_numeric(hist["l3_subsector_er"], errors="coerce").to_numpy(dtype=float)
    res = ret - mkt * ret - sec * ret - sub * ret

    base = pd.DataFrame({"teo": teo_dt, "res": res})

    for w in windows:
        out: dict[str, float | None] = {k: None for k in _DD_MACRO_KEYS}
        any_valid = False
        for zfac, dd_key in _ZARR_FACTOR_TO_DD_KEY.items():
            if zfac not in ds_m.factor.values:
                continue
            try:
                sel = ds_m.sel(factor=zfac)
                mdf = pd.DataFrame(
                    {
                        "teo": pd.to_datetime(sel.teo.values),
                        "mret": np.asarray(sel["return"].values, dtype=float),
                    }
                )
                j = base.merge(mdf, on="teo", how="inner")
                j = j.replace([np.inf, -np.inf], np.nan).dropna(subset=["res", "mret"])
                if len(j) < min_overlap:
                    continue
                subw = j.tail(min(w, len(j)))
                if len(subw) < min_overlap:
                    continue
                c = subw["res"].corr(subw["mret"])
                if c is not None and np.isfinite(c):
                    out[dd_key] = float(c)
                    any_valid = True
            except Exception:
                continue
        if any_valid:
            return out, f"{w}d"

    return {k: None for k in _DD_MACRO_KEYS}, "252d"


def fetch_stock_context_zarr(
    ticker: str,
    zarr_root: Path | None = None,
    *,
    years: int = 2,
    erm3_root: Path | None = None,
    include_macro: bool = True,
    as_of_date: str | None = None,
    sector_etf_override: str | None = None,
    subsector_etf_override: str | None = None,
) -> tuple[StockContext, dict[str, Any], dict[str, float | None], str]:
    """Load zarr stores and return :class:`StockContext`, rankings, macro correlations, macro window.

    Parameters
    ----------
    as_of_date : Trim history to <= this date (YYYY-MM-DD). Useful when comparing against
        an API snapshot from a specific date (e.g. when Supabase data lags one day).
    sector_etf_override / subsector_etf_override : Override the auto-derived sector/subsector
        ETF (from fundamentals.csv). Use this to match the API's classification.
    """
    root = Path(zarr_root) if zarr_root is not None else _DEFAULT_ZARR
    erm3 = Path(erm3_root) if erm3_root is not None else _DEFAULT_ERM3

    ticker = ticker.upper()
    n_days = int(252 * years) + 20

    ds_daily = xr.open_zarr(root / "ds_daily.zarr", consolidated=True)
    ds_erm = xr.open_zarr(root / "ds_erm3_hedge_weights_SPY_uni_mc_3000.zarr", consolidated=True)
    ds_etf = xr.open_zarr(root / "ds_etf.zarr", consolidated=True)
    ds_rank = xr.open_zarr(root / "ds_rankings_SPY_uni_mc_3000.zarr", consolidated=True)

    # ds_daily is the ticker→symbol authority (uses canonical bw_sym_id from SecurityMaster).
    # All other zarr datasets share the same symbol coordinate after dedup/reindex.
    sym = _symbol_for_ticker(ds_daily, ticker)

    # If as_of_date is provided, find the index of that date and slice up to it
    if as_of_date is not None:
        target = np.datetime64(as_of_date)
        all_teos = ds_daily.sel(symbol=sym).teo.values
        # Find last index where teo <= target
        valid_idx = np.where(all_teos <= target)[0]
        if len(valid_idx) == 0:
            raise ValueError(f"No data on or before {as_of_date} for {ticker}")
        end_idx = int(valid_idx[-1]) + 1  # exclusive end
        start_idx = max(0, end_idx - n_days)
        sub_d = ds_daily.sel(symbol=sym).isel(teo=slice(start_idx, end_idx))
        sub_e = ds_erm.sel(symbol=sym).isel(teo=slice(start_idx, end_idx))
    else:
        sub_d = ds_daily.sel(symbol=sym).isel(teo=slice(-n_days, None))
        sub_e = ds_erm.sel(symbol=sym).isel(teo=slice(-n_days, None))
    merged = xr.merge(
        [
            sub_d[["return", "close", "market_cap", "volatility", "bw_sector_code", "fs_industry_code"]],
            sub_e[
                [
                    "L3_market_HR",
                    "L3_sector_HR",
                    "L3_subsector_HR",
                    "L3_residual_ER",
                    "L3_market_ER",
                    "L3_sector_ER",
                    "L3_subsector_ER",
                    "_stock_var",
                ]
            ],
        ],
        join="inner",
        compat="override",
    )
    df = merged.to_dataframe().reset_index()
    df["date"] = pd.to_datetime(df["teo"]).dt.strftime("%Y-%m-%d")
    df = df.rename(columns={"return": "returns_gross", "close": "price_close"})
    df["returns_gross"] = pd.to_numeric(df["returns_gross"], errors="coerce").fillna(0.0)
    df["l3_market_er"] = pd.to_numeric(df["L3_market_ER"], errors="coerce").fillna(0.0)
    df["l3_sector_er"] = pd.to_numeric(df["L3_sector_ER"], errors="coerce").fillna(0.0)
    df["l3_subsector_er"] = pd.to_numeric(df["L3_subsector_ER"], errors="coerce").fillna(0.0)
    df["l3_residual_er"] = pd.to_numeric(df["L3_residual_ER"], errors="coerce").fillna(0.0)
    hist = df

    last = hist.iloc[-1]
    teo = str(last["date"])[:10]
    bw = float(last["bw_sector_code"]) if pd.notna(last.get("bw_sector_code")) else None
    fs_ind = float(last["fs_industry_code"]) if pd.notna(last.get("fs_industry_code")) else None
    sector_etf = sector_etf_override or _sector_etf(bw)
    subsector_etf = subsector_etf_override or _subsector_etf(fs_ind, erm3)

    # API behavior: each ETF series uses its own latest date independently of the stock.
    # When matching the API, ETFs may have 1 day MORE than the stock if Supabase synced them
    # later. We fetch the ETF's full window matching the API's `years=2` calendar logic.
    n_etf_days = len(hist) + 5  # buffer for ETF having extra recent days

    def _etf_slice_independent(etf_ticker: str | None) -> pd.DataFrame | None:
        if not etf_ticker:
            return None
        try:
            etf_sym = _etf_symbol(ds_etf, etf_ticker)
        except ValueError:
            return None
        full = ds_etf.sel(symbol=etf_sym)
        # Take the last n_etf_days rows (ETF's own latest, not stock-aligned)
        return _df_from_etf_slice_indexed(full.isel(teo=slice(-n_etf_days, None)))

    spy_df = _etf_slice_independent("SPY")
    sec_df = _etf_slice_independent(sector_etf)
    sub_df = _etf_slice_independent(subsector_etf)

    erm_last = ds_erm.sel(symbol=sym, teo=merged.teo.values[-1])
    # Derive vol_23d from _stock_var (matches API formula: sqrt(stock_var * 252))
    sv = float(erm_last["_stock_var"].values)
    vol_23d = math.sqrt(sv * 252) if np.isfinite(sv) else float("nan")

    m: dict[str, Any] = {
        "ticker": ticker,
        "date": teo,
        "l3_market_er": float(erm_last["L3_market_ER"].values),
        "l3_sector_er": float(erm_last["L3_sector_ER"].values),
        "l3_subsector_er": float(erm_last["L3_subsector_ER"].values),
        "l3_residual_er": float(erm_last["L3_residual_ER"].values),
        "l3_market_hr": float(erm_last["L3_market_HR"].values),
        "l3_sector_hr": float(erm_last["L3_sector_HR"].values),
        "l3_subsector_hr": float(erm_last["L3_subsector_HR"].values),
        "close_price": float(last["price_close"]),
        "market_cap": float(last["market_cap"]) if pd.notna(last["market_cap"]) else None,
        "vol_23d": vol_23d,
        "stock_var": float(erm_last["_stock_var"].values)
        if np.isfinite(erm_last["_stock_var"].values)
        else None,
    }

    teo_coord = np.datetime64(merged.teo.values[-1])
    rankings = _rankings_dict_from_zarr(ds_rank, sym, teo_coord)

    if include_macro:
        macro_corr, macro_win = _macro_correlations_from_zarr(merged, hist, root)
    else:
        macro_corr, macro_win = {k: None for k in _DD_MACRO_KEYS}, "252d"

    ctx = StockContext(
        ticker=ticker,
        company_name=_resolve_company_name_local(ticker, erm3),
        teo=teo,
        universe="uni_mc_3000",
        sector_etf=sector_etf,
        subsector_etf=subsector_etf,
        metrics=m,
        market_cap=m.get("market_cap"),
        history=hist,
        sector_returns=sec_df,
        subsector_returns=sub_df,
        spy_returns=spy_df,
        years=float(years),
        sdk_version="zarr-local",
    )
    return ctx, rankings, macro_corr, macro_win


def build_p1_from_zarr(
    ticker: str,
    zarr_root: Path | None = None,
    *,
    years: int = 2,
    erm3_root: Path | None = None,
    include_macro: bool = True,
    as_of_date: str | None = None,
    sector_etf_override: str | None = None,
    subsector_etf_override: str | None = None,
) -> "P1Data":
    """Same :class:`P1Data` contract as ``get_data_for_p1``, sourced from zarr.

    See :func:`fetch_stock_context_zarr` for parameter docs.
    """
    from .p1_stock_performance import build_p1_data_from_stock_context

    ctx, rankings, macro_corr, macro_win = fetch_stock_context_zarr(
        ticker, zarr_root,
        years=years,
        erm3_root=erm3_root,
        include_macro=include_macro,
        as_of_date=as_of_date,
        sector_etf_override=sector_etf_override,
        subsector_etf_override=subsector_etf_override,
    )
    return build_p1_data_from_stock_context(
        ctx,
        client=None,
        rankings=rankings,
        macro_correlations=macro_corr,
        macro_window=macro_win,
    )
