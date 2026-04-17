"""Zarr-only peer discovery + peer analytics (drops all API calls for bulk DD renders).

Mirrors the API path used by :mod:`riskmodels.peer_group.PeerGroupProxy` +
:func:`riskmodels.snapshots.stock_deep_dive.compute_peer_analytics`, but reads
everything from the local ERM3 zarr stack:

- Peer discovery  → ds_daily (fs_industry_code + market_cap at latest teo)
- Peer metrics    → ds_erm3_hedge_weights (latest teo L3 HR/ER per peer)
- Historical returns for correlation/Sharpe → ds_daily + ds_erm3_returns

This lets `bulk_dd_render.py` render 1k+ DD snapshots with the full Section III
(Correlation ρ + 3-Year Sharpe pill columns + alpha trajectory) without a single
HTTP call, hence no rate-limit throttling and no per-call billing.
"""

from __future__ import annotations

import math as _math
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import xarray as xr

from ..lineage import RiskLineage
from ..peer_group import PeerComparison
from ..portfolio_math import PortfolioAnalysis
from .zarr_context import (
    _DEFAULT_ERM3,
    _sector_etf,
    _subsector_etf,
    _symbol_for_ticker,
)


# ---------------------------------------------------------------------------
# Peer discovery
# ---------------------------------------------------------------------------

def _open_zarr_stores(zarr_root: Path) -> tuple[xr.Dataset, xr.Dataset, xr.Dataset]:
    ds_daily = xr.open_zarr(zarr_root / "ds_daily.zarr", consolidated=True)
    ds_erm = xr.open_zarr(
        zarr_root / "ds_erm3_hedge_weights_SPY_uni_mc_3000.zarr",
        consolidated=True,
    )
    ret_path = zarr_root / "ds_erm3_returns_SPY_uni_mc_3000.zarr"
    ds_returns = xr.open_zarr(ret_path, consolidated=True) if ret_path.is_dir() else None
    return ds_daily, ds_erm, ds_returns


def _latest_daily_slice(ds_daily: xr.Dataset) -> xr.Dataset:
    """Return ds_daily at the most recent teo coordinate."""
    last_teo = ds_daily.teo.values[-1]
    return ds_daily.sel(teo=last_teo)


def _ticker_from_symbol(ds: xr.Dataset, symbol: str) -> str | None:
    """Lookup human ticker for a symbol coord in ds. Returns None if missing."""
    sym_vals = np.asarray(ds.symbol.values)
    idx = np.where(sym_vals == symbol)[0]
    if not len(idx):
        return None
    t = np.asarray(ds["ticker"].values)[int(idx[0])]
    if isinstance(t, bytes):
        t = t.decode("utf-8")
    s = str(t).strip().upper()
    return s or None


def build_peer_comparison_from_zarr(
    ticker: str,
    zarr_root: Path,
    erm3_root: Path | None = None,
    *,
    max_peers: int = 15,
    weighting: str = "market_cap",
) -> PeerComparison | None:
    """Discover same-subsector peers from ds_daily and return a :class:`PeerComparison`.

    Cap-weighted by default (matching :meth:`PeerGroupProxy.from_ticker`
    behavior). Returns ``None`` if the target cannot be classified (no
    ``fs_industry_code``) or has no peers in the universe mask.
    """
    erm3 = Path(erm3_root) if erm3_root is not None else _DEFAULT_ERM3
    ticker = ticker.upper()

    ds_daily, ds_erm, _ = _open_zarr_stores(zarr_root)
    try:
        target_sym = _symbol_for_ticker(ds_daily, ticker)
    except ValueError:
        return None

    d_last = _latest_daily_slice(ds_daily)
    # Grab per-symbol fs_industry_code, bw_sector_code, market_cap at latest teo.
    fs_ind_arr = np.asarray(d_last["fs_industry_code"].values).astype(float)
    bw_arr = np.asarray(d_last["bw_sector_code"].values).astype(float)
    mc_arr = np.asarray(d_last["market_cap"].values).astype(float)
    sym_arr = np.asarray(d_last.symbol.values)
    tkr_arr = np.asarray(d_last["ticker"].values)

    target_idx_arr = np.where(sym_arr == target_sym)[0]
    if not len(target_idx_arr):
        return None
    target_idx = int(target_idx_arr[0])

    t_fs_ind = fs_ind_arr[target_idx]
    t_bw = bw_arr[target_idx]
    target_subsector_etf = _subsector_etf(t_fs_ind if np.isfinite(t_fs_ind) else None, erm3)
    target_sector_etf = _sector_etf(t_bw if np.isfinite(t_bw) else None)
    group_etf = target_subsector_etf or target_sector_etf
    if not np.isfinite(t_fs_ind) or not group_etf:
        return None

    # Same-subsector peers (and fallback to same-sector if too few).
    same_sub = np.where(
        np.isfinite(fs_ind_arr) & (fs_ind_arr == t_fs_ind) & (sym_arr != target_sym)
    )[0]
    if len(same_sub) < 3 and np.isfinite(t_bw):
        same_sub = np.where(
            np.isfinite(bw_arr) & (bw_arr == t_bw) & (sym_arr != target_sym)
        )[0]

    # Rank by market cap (descending), finite only, take top N.
    candidates = [
        (int(i), float(mc_arr[i]), str(tkr_arr[i]).upper())
        for i in same_sub
        if np.isfinite(mc_arr[i]) and mc_arr[i] > 0
    ]
    candidates.sort(key=lambda r: r[1], reverse=True)
    candidates = candidates[:max_peers]
    if not candidates:
        return None

    # Per-peer L3 HR/ER from ds_erm3_hedge_weights at latest teo.
    e_last_teo = ds_erm.teo.values[-1]
    e_last = ds_erm.sel(teo=e_last_teo)
    erm_syms = np.asarray(e_last.symbol.values)
    erm_lookup = {s: i for i, s in enumerate(erm_syms.tolist())}

    def _read_erm_fields(sym: str) -> dict[str, float | None]:
        i = erm_lookup.get(sym)
        if i is None:
            return {k: None for k in (
                "l3_market_er", "l3_sector_er", "l3_subsector_er",
                "l3_residual_er", "l3_market_hr", "l3_sector_hr",
                "l3_subsector_hr", "_stock_var",
            )}
        def _g(var_name: str) -> float | None:
            if var_name not in e_last.data_vars:
                return None
            v = np.asarray(e_last[var_name].values)[i]
            f = float(np.float32(v)) if np.isfinite(v) else None
            return f
        return {
            "l3_market_er":    _g("L3_market_ER"),
            "l3_sector_er":    _g("L3_sector_ER"),
            "l3_subsector_er": _g("L3_subsector_ER"),
            "l3_residual_er":  _g("L3_residual_ER"),
            "l3_market_hr":    _g("L3_market_HR"),
            "l3_sector_hr":    _g("L3_sector_HR"),
            "l3_subsector_hr": _g("L3_subsector_HR"),
            "_stock_var":      _g("_stock_var"),
        }

    peer_rows: list[dict[str, Any]] = []
    total_cap = 0.0
    for i, mc, tkr in candidates:
        sym = str(sym_arr[i])
        fields = _read_erm_fields(sym)
        sv = fields.pop("_stock_var")
        vol_23d = _math.sqrt(sv * 252) if sv is not None and sv > 0 else None
        row: dict[str, Any] = {
            "ticker": tkr,
            "market_cap": mc,
            "vol_23d": vol_23d,
        }
        row.update(fields)
        peer_rows.append(row)
        total_cap += mc if (mc is not None and np.isfinite(mc)) else 0.0

    # Cap-weighted (fallback to equal if caps are zero/NaN).
    if weighting == "market_cap" and total_cap > 0:
        for r in peer_rows:
            r["weight"] = float(r["market_cap"] / total_cap)
    else:
        n = len(peer_rows)
        for r in peer_rows:
            r["weight"] = 1.0 / n

    peer_detail = pd.DataFrame(peer_rows).set_index("ticker")

    # Build a minimal PortfolioAnalysis (only fields the renderer reads). The
    # pill columns come from peer_correlations / peer_sharpes, not from this.
    weights = {t: float(peer_detail.at[t, "weight"]) for t in peer_detail.index}
    peer_portfolio = PortfolioAnalysis(
        lineage=RiskLineage(),
        per_ticker=peer_detail.reset_index(),
        portfolio_hedge_ratios={},
        portfolio_l3_er_weighted_mean={},
        weights=weights,
        errors={},
    )

    # Target's own L3 residual ER + vol for summary fields.
    t_fields = _read_erm_fields(str(target_sym))
    t_sv = t_fields.pop("_stock_var")
    target_vol = _math.sqrt(t_sv * 252) if t_sv is not None and t_sv > 0 else None
    target_resid_er = t_fields.get("l3_residual_er")
    peer_avg_resid = float(
        pd.to_numeric(peer_detail["l3_residual_er"], errors="coerce").dropna().mean()
    ) if "l3_residual_er" in peer_detail.columns else None
    if peer_avg_resid is not None and not np.isfinite(peer_avg_resid):
        peer_avg_resid = None
    peer_avg_vol = float(
        pd.to_numeric(peer_detail["vol_23d"], errors="coerce").dropna().mean()
    ) if "vol_23d" in peer_detail.columns else None
    if peer_avg_vol is not None and not np.isfinite(peer_avg_vol):
        peer_avg_vol = None

    selection_spread = (
        (target_resid_er - peer_avg_resid)
        if (target_resid_er is not None and peer_avg_resid is not None)
        else None
    )

    return PeerComparison(
        target_ticker=ticker,
        peer_group_label=f"{group_etf} Subsector Peers (cap-wt, N={len(peer_rows)})",
        target_metrics=t_fields,
        peer_portfolio=peer_portfolio,
        target_l3_residual_er=target_resid_er,
        peer_avg_l3_residual_er=peer_avg_resid,
        selection_spread=selection_spread,
        target_vol=target_vol,
        peer_avg_vol=peer_avg_vol,
        peer_detail=peer_detail,
    )


# ---------------------------------------------------------------------------
# History DataFrame (zarr equivalent of client.get_ticker_returns)
# ---------------------------------------------------------------------------

def _history_df_from_zarr(
    ds_daily: xr.Dataset,
    ds_erm: xr.Dataset,
    ds_returns: xr.Dataset | None,
    symbol: str,
    *,
    years: int = 5,
) -> pd.DataFrame:
    """Return daily history for one symbol, schema matching `client.get_ticker_returns`.

    Columns: ``date`` (str), ``returns_gross``, ``l3_market_er``, ``l3_sector_er``,
    ``l3_subsector_er``, ``l3_residual_er``, ``l3_combined_factor_return`` (when
    available).
    """
    n_days = int(252 * years) + 20
    sub_d = ds_daily.sel(symbol=symbol).isel(teo=slice(-n_days, None))
    sub_e = ds_erm.sel(symbol=symbol).isel(teo=slice(-n_days, None))
    merged = xr.merge(
        [
            sub_d[["return"]],
            sub_e[[
                "L3_market_ER", "L3_sector_ER",
                "L3_subsector_ER", "L3_residual_ER",
            ]],
        ],
        join="inner", compat="override",
    )
    df = merged.to_dataframe().reset_index()
    df["date"] = pd.to_datetime(df["teo"])
    df = df.rename(columns={
        "return": "returns_gross",
        "L3_market_ER": "l3_market_er",
        "L3_sector_ER": "l3_sector_er",
        "L3_subsector_ER": "l3_subsector_er",
        "L3_residual_ER": "l3_residual_er",
    })
    for col in ("returns_gross", "l3_market_er", "l3_sector_er",
                "l3_subsector_er", "l3_residual_er"):
        df[col] = pd.to_numeric(df[col], errors="coerce").astype(np.float32)

    # L3 combined_factor_return from ds_erm3_returns (level='subsector').
    if ds_returns is not None and symbol in set(ds_returns.symbol.values):
        try:
            sub_r = ds_returns.sel(symbol=symbol).sel(teo=df["teo"].values, method=None)
            if "subsector" in sub_r.level.values:
                cfr = sub_r["combined_factor_return"].sel(level="subsector").values
                df["l3_combined_factor_return"] = pd.Series(cfr).astype(np.float32).values
        except Exception:
            pass

    return df[[c for c in df.columns if c != "teo"]]


# ---------------------------------------------------------------------------
# Correlations + 3Y Sharpe + alpha trajectory (zarr)
# ---------------------------------------------------------------------------

_ER_COLS = ["l3_market_er", "l3_sector_er", "l3_subsector_er"]


def _l3_resid_series(df: pd.DataFrame) -> pd.Series:
    gr = pd.to_numeric(df["returns_gross"], errors="coerce")
    if "l3_combined_factor_return" in df.columns:
        cfr = pd.to_numeric(df["l3_combined_factor_return"], errors="coerce")
        if cfr.notna().sum() > 30:
            return gr - cfr
    mkt = pd.to_numeric(df["l3_market_er"], errors="coerce").fillna(0)
    sec = pd.to_numeric(df["l3_sector_er"], errors="coerce").fillna(0)
    sub = pd.to_numeric(df["l3_subsector_er"], errors="coerce").fillna(0)
    return gr - (mkt * gr + sec * gr + sub * gr)


def _sharpe_3y(df: pd.DataFrame) -> tuple[float | None, float | None]:
    gross = pd.to_numeric(df["returns_gross"], errors="coerce").dropna()
    g_sharpe = None
    r_sharpe = None
    if len(gross) >= 252:
        g_std = gross.std()
        if g_std > 0:
            g_sharpe = float(gross.mean() / g_std * _math.sqrt(252))
    if all(c in df.columns for c in _ER_COLS) and len(gross) >= 252:
        resid = _l3_resid_series(df).dropna()
        if len(resid) >= 252:
            r_std = resid.std()
            if r_std > 0:
                r_sharpe = float(resid.mean() / r_std * _math.sqrt(252))
    return g_sharpe, r_sharpe


def compute_peer_analytics_from_zarr(
    ticker: str,
    zarr_root: Path,
    peer_comparison: PeerComparison | None,
) -> tuple[
    dict[str, tuple[float | None, float | None]],
    dict[str, tuple[float | None, float | None]],
    list[tuple[str, float, float]],
]:
    """Zarr equivalent of :func:`compute_peer_analytics`, no HTTP calls.

    Returns ``(peer_correlations, peer_sharpes, alpha_trajectory)`` with the
    same keys/shapes as the API path so :func:`_make_peer_dna_chart` renders
    identically.
    """
    peer_correlations: dict[str, tuple[float | None, float | None]] = {}
    peer_sharpes: dict[str, tuple[float | None, float | None]] = {}
    alpha_trajectory: list[tuple[str, float, float]] = []
    ticker = ticker.upper()

    ds_daily, ds_erm, ds_returns = _open_zarr_stores(zarr_root)

    try:
        try:
            target_sym = _symbol_for_ticker(ds_daily, ticker)
        except ValueError:
            return peer_correlations, peer_sharpes, alpha_trajectory

        # Target history (5Y — enough for trajectory + 3Y Sharpe + 1Y correlation).
        target_df = _history_df_from_zarr(ds_daily, ds_erm, ds_returns, target_sym, years=5)
        if target_df.empty:
            return peer_correlations, peer_sharpes, alpha_trajectory
        target_df = target_df.set_index("date").sort_index()

        # Target's own Sharpe lands under target ticker (matches API convention).
        peer_sharpes[ticker] = _sharpe_3y(target_df)

        # Peer loop — top 6 peers, identical to the API path.
        if peer_comparison is not None and not peer_comparison.peer_detail.empty:
            sort_col = "market_cap" if "market_cap" in peer_comparison.peer_detail.columns else "weight"
            top_peer_tickers = list(
                peer_comparison.peer_detail
                .sort_values(sort_col, ascending=False, na_position="last")
                .head(6).index
            )
            # Ticker → symbol lookup for peers.
            d_last = _latest_daily_slice(ds_daily)
            tkr_arr = np.asarray(d_last["ticker"].values)
            sym_arr = np.asarray(d_last.symbol.values)
            tkr_upper = np.array([
                (t.decode("utf-8") if isinstance(t, bytes) else str(t)).upper().strip()
                for t in tkr_arr
            ])
            lookup = {t: s for t, s in zip(tkr_upper, sym_arr) if t}

            for pt in top_peer_tickers:
                sym = lookup.get(str(pt).upper())
                if sym is None:
                    continue
                try:
                    peer_df = _history_df_from_zarr(
                        ds_daily, ds_erm, ds_returns, sym, years=3
                    )
                    if peer_df.empty:
                        continue
                    peer_df = peer_df.set_index("date").sort_index()

                    peer_sharpes[str(pt)] = _sharpe_3y(peer_df)

                    common = target_df.index.intersection(peer_df.index)
                    common_1y = common[-252:] if len(common) > 252 else common
                    if len(common_1y) < 30:
                        continue

                    gross_rho = None
                    t_g = pd.to_numeric(target_df.loc[common_1y, "returns_gross"], errors="coerce")
                    p_g = pd.to_numeric(peer_df.loc[common_1y, "returns_gross"], errors="coerce")
                    mask = t_g.notna() & p_g.notna()
                    if mask.sum() >= 30:
                        gross_rho = float(t_g[mask].corr(p_g[mask]))

                    resid_rho = None
                    t_has_er = all(c in target_df.columns for c in _ER_COLS)
                    p_has_er = all(c in peer_df.columns for c in _ER_COLS)
                    if t_has_er and p_has_er:
                        t_res = _l3_resid_series(target_df.loc[common_1y])
                        p_res = _l3_resid_series(peer_df.loc[common_1y])
                        mask = t_res.notna() & p_res.notna()
                        if mask.sum() >= 30:
                            resid_rho = float(t_res[mask].corr(p_res[mask]))

                    peer_correlations[str(pt)] = (gross_rho, resid_rho)
                except Exception:
                    continue

        # Alpha trajectory — per-year trailing-252-day residual vol + residual ER.
        try:
            traj_df = target_df.reset_index()
            gross = pd.to_numeric(traj_df["returns_gross"], errors="coerce")
            mkt_er = pd.to_numeric(traj_df["l3_market_er"], errors="coerce").fillna(0)
            sec_er = pd.to_numeric(traj_df["l3_sector_er"], errors="coerce").fillna(0)
            sub_er = pd.to_numeric(traj_df["l3_subsector_er"], errors="coerce").fillna(0)
            res_er_frac = 1.0 - mkt_er - sec_er - sub_er
            res_return = gross * res_er_frac
            total_days = len(gross.dropna())
            window = 252
            for yr_idx in range(min(4, total_days // window)):
                end = total_days - yr_idx * window
                start = end - window
                if start < 0:
                    break
                chunk_res = res_return.iloc[start:end].dropna()
                chunk_er_frac = res_er_frac.iloc[start:end].dropna()
                if len(chunk_res) < 100:
                    continue
                res_vol_ann = float(chunk_res.std() * (252 ** 0.5)) * 100
                avg_res_er = float(chunk_er_frac.mean()) * 100
                year_label = f"Y-{yr_idx + 1}" if yr_idx > 0 else "Current"
                alpha_trajectory.append((year_label, res_vol_ann, avg_res_er))
        except Exception:
            pass

        return peer_correlations, peer_sharpes, alpha_trajectory
    finally:
        ds_daily.close()
        ds_erm.close()
        if ds_returns is not None:
            ds_returns.close()
