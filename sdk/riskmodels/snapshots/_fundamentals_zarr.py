"""PIT-gated fundamentals reader for ``ds_fundamentals.zarr`` — offline SDK path.

Sibling to :func:`riskmodels.snapshots.zarr_context.fetch_stock_context_zarr`: opens the
zarr store directly (no REST call), for the bulk/offline snapshot pipeline
(:func:`riskmodels.snapshots.zarr_context.build_p1_from_zarr`).

Reuses ``erm3.shared.fundamentals_reader`` for the PIT gate and TTM aggregation
(``pit_period_indices``, ``ttm_sum``, ``ttm_avg``, ``latest_finite``) rather than
reimplementing them — that module is the PIT/TTM convention SSOT (H.89.1).

LICENSING (H.69, store attrs): EODHD-sourced cells may only ship DERIVED quantities,
never raw levels. Every field this module returns is a ratio or a PIT stamp — never a
raw revenue/net-income/EPS dollar figure. ``currency_suspect`` is propagated as a flag
for the renderer to ANNOTATE, never to suppress: the store's own
``currency_suspect_legend`` attr states ratios of two same-currency line items
(margins/ROE/leverage/growth) remain valid even for flagged (IFRS foreign-filer) names.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


@dataclass
class FundamentalsPIT:
    """PIT-gated fundamentals snapshot for one ticker as-of one ``teo``.

    All fields except ``currency_suspect``/``reports_within_10d`` are ``None`` when
    not computable (insufficient finite history) rather than a misleading 0/NaN.
    """

    as_of_period_end: str | None
    filed_date: str | None
    revenue_growth_yoy_ttm: float | None
    net_margin_ttm: float | None
    fcf_margin_ttm: float | None
    roe_ttm: float | None
    leverage_ratio: float | None  # D/E, latest finite total_debt / total_equity
    last_eps_surprise_pct: float | None  # (actual-estimate)/abs(estimate), most recent closed qtr w/ both
    beat_streak: int | None  # consecutive quarters (from most recent) actual > estimate
    currency_suspect: bool
    last_filed_date: str | None
    estimated_next_filed_date: str | None
    median_cadence_days: float | None
    reports_within_10d: bool
    trajectory: list[dict[str, Any]] = field(default_factory=list)


def _iso_date(dt64: Any) -> str | None:
    dt64 = np.datetime64(dt64)
    if np.isnat(dt64):
        return None
    return str(dt64.astype("datetime64[D]"))


def build_fundamentals_pit(
    ticker: str,
    zarr_root: Path | None = None,
    *,
    teo: str | None = None,
    erm3_root: Path | None = None,
    n_quarters: int = 20,
) -> FundamentalsPIT | None:
    """PIT-gated fundamentals block for ``ticker`` as-of ``teo`` (defaults to now).

    Returns ``None`` (with a ``UserWarning``) when ``ds_fundamentals.zarr`` is absent,
    the ticker isn't in its symbol axis, or no period is visible at ``teo`` — soft-fail,
    matching the rankings/macro-correlation fallback convention in ``zarr_context.py``.
    """
    from .zarr_context import _default_zarr_root, _DEFAULT_ERM3, _ensure_erm3_import

    root = Path(zarr_root) if zarr_root is not None else _default_zarr_root()
    erm3 = Path(erm3_root) if erm3_root is not None else _DEFAULT_ERM3
    store_path = root / "ds_fundamentals.zarr"
    if not store_path.is_dir():
        warnings.warn(
            f"ds_fundamentals.zarr not found under {root}; fundamentals block omitted",
            UserWarning, stacklevel=2,
        )
        return None

    _ensure_erm3_import(erm3)
    from erm3.shared.fundamentals_reader import (
        FundamentalsReader, latest_finite, ttm_avg, ttm_sum,
    )

    from ..fundamentals import estimate_next_earnings

    ticker = ticker.upper()
    teo_ts = pd.Timestamp(teo) if teo is not None else pd.Timestamp.now()

    reader = FundamentalsReader(store_path)
    try:
        i = reader._sym_index(ticker)
        if i is None:
            warnings.warn(
                f"{ticker} not in ds_fundamentals.zarr symbol axis; fundamentals block omitted",
                UserWarning, stacklevel=2,
            )
            return None

        idx = reader.pit_period_indices(i, teo_ts, n=8)
        if not idx:
            warnings.warn(
                f"{ticker}: no ds_fundamentals period visible at teo={teo_ts}; "
                "fundamentals block omitted",
                UserWarning, stacklevel=2,
            )
            return None

        ds = reader.ds

        def col(name: str, at_idx: list[int]) -> np.ndarray:
            if name not in ds.data_vars:
                return np.full(len(at_idx), np.nan)
            return np.asarray(ds[name].isel(symbol=i).values)[at_idx]

        revenue = col("revenue", idx)
        net_income = col("net_income", idx)
        cfo = col("cash_from_operations", idx)
        capex = col("capital_expenditures", idx)
        total_equity = col("total_equity", idx)
        total_debt = col("total_debt", idx)

        period_end_vals = np.asarray(ds["period_end_date"].values)[idx]
        filed_vals = np.asarray(ds["filed_date"].isel(symbol=i).values)[idx]
        as_of_period_end = _iso_date(period_end_vals[-1])
        last_filed_stamp = _iso_date(filed_vals[-1])

        revenue_ttm = ttm_sum(revenue)
        revenue_ttm_prior = ttm_sum(revenue[:-4]) if len(revenue) > 4 else np.nan
        revenue_growth_yoy_ttm = (
            float(revenue_ttm / revenue_ttm_prior - 1.0)
            if np.isfinite(revenue_ttm) and np.isfinite(revenue_ttm_prior) and revenue_ttm_prior != 0
            else None
        )

        net_income_ttm = ttm_sum(net_income)
        net_margin_ttm = (
            float(net_income_ttm / revenue_ttm)
            if np.isfinite(net_income_ttm) and np.isfinite(revenue_ttm) and revenue_ttm != 0
            else None
        )

        cfo_ttm = ttm_sum(cfo)
        capex_ttm = ttm_sum(capex)
        fcf_margin_ttm = (
            float((cfo_ttm - capex_ttm) / revenue_ttm)
            if np.isfinite(cfo_ttm) and np.isfinite(capex_ttm) and np.isfinite(revenue_ttm) and revenue_ttm != 0
            else None
        )

        avg_equity = ttm_avg(total_equity)
        roe_ttm_val = (
            float(net_income_ttm / avg_equity)
            if np.isfinite(net_income_ttm) and np.isfinite(avg_equity) and avg_equity > 0
            else None
        )

        equity_latest = latest_finite(total_equity)
        debt_latest = latest_finite(total_debt)
        leverage_ratio = (
            float(debt_latest / equity_latest)
            if np.isfinite(debt_latest) and np.isfinite(equity_latest) and equity_latest != 0
            else None
        )

        last_eps_surprise_pct, beat_streak = _surprise_and_streak(
            col("eps_actual", idx), col("eps_estimate", idx), revenue
        )

        currency_suspect = (
            bool(np.asarray(ds["currency_suspect"].isel(symbol=i).values).item())
            if "currency_suspect" in ds.data_vars else False
        )

        # Earnings-calendar cadence uses the FULL visible history (not the 8-quarter
        # TTM window) for a stable median-gap estimate.
        filed_full = np.asarray(ds["filed_date"].isel(symbol=i).values)
        teo_i8 = np.datetime64(teo_ts, "ns")
        visible_mask = ~np.isnat(filed_full) & (filed_full.astype("datetime64[ns]") <= teo_i8)
        filed_dates_sorted = sorted(_iso_date(d) for d in filed_full[visible_mask])
        next_est = estimate_next_earnings(ticker, [{"filed_date": d} for d in filed_dates_sorted])
        reports_within_10d = False
        if next_est.estimated_next_filed_date is not None:
            delta_days = (pd.Timestamp(next_est.estimated_next_filed_date) - teo_ts).days
            reports_within_10d = delta_days <= 10

        trajectory = _build_trajectory(reader, i, teo_ts, n_quarters)

        return FundamentalsPIT(
            as_of_period_end=as_of_period_end,
            filed_date=last_filed_stamp,
            revenue_growth_yoy_ttm=revenue_growth_yoy_ttm,
            net_margin_ttm=net_margin_ttm,
            fcf_margin_ttm=fcf_margin_ttm,
            roe_ttm=roe_ttm_val,
            leverage_ratio=leverage_ratio,
            last_eps_surprise_pct=last_eps_surprise_pct,
            beat_streak=beat_streak,
            currency_suspect=currency_suspect,
            last_filed_date=next_est.last_filed_date,
            estimated_next_filed_date=next_est.estimated_next_filed_date,
            median_cadence_days=next_est.median_cadence_days,
            reports_within_10d=reports_within_10d,
            trajectory=trajectory,
        )
    finally:
        reader.close()


def _surprise_and_streak(
    eps_actual: np.ndarray, eps_estimate: np.ndarray, revenue: np.ndarray,
) -> tuple[float | None, int | None]:
    """Most-recent EPS surprise % + consecutive-beat streak, walking newest -> oldest.

    ``eps_actual``/``eps_estimate``/``revenue`` are oldest -> newest (as returned by
    ``pit_period_indices``). The streak stops at the first miss or the first quarter
    missing either value; it never looks past a gap. ``revenue`` finiteness is required
    too, as a partial-capture guard: EODHD occasionally lands a quarter's ``filed_date``
    and ``eps_actual``/``eps_estimate`` before its Financials section is fully captured,
    which can otherwise surface a spurious 0.0 "actual" — revenue is the most reliably
    populated flow field, so its absence is a good signal the quarter isn't really in yet.
    """
    last_surprise_pct: float | None = None
    streak = 0
    started = False
    for a, e, r in zip(eps_actual[::-1], eps_estimate[::-1], revenue[::-1]):
        if not (np.isfinite(a) and np.isfinite(e) and np.isfinite(r)):
            if started:
                break
            continue  # skip a trailing unreported/unestimated/partially-captured quarter
        if not started:
            started = True
            if e != 0:
                last_surprise_pct = float((a - e) / abs(e))
        if a > e:
            streak += 1
        else:
            break
    return last_surprise_pct, (streak if started else None)


def _build_trajectory(reader: Any, i: int, teo_ts: pd.Timestamp, n_quarters: int) -> list[dict[str, Any]]:
    """Last ``n_quarters`` visible quarters, per-quarter (not TTM-smoothed) — the
    right-panel small-multiples input (EPS surprise, revenue YoY, FCF margin)."""
    ds = reader.ds
    # Widen by 4 so the oldest trajectory point can still compute revenue YoY.
    wide_idx = reader.pit_period_indices(i, teo_ts, n=n_quarters + 4)
    traj_idx = wide_idx[-n_quarters:] if len(wide_idx) > n_quarters else wide_idx
    offset = len(wide_idx) - len(traj_idx)
    if not traj_idx:
        return []

    def col(name: str, at_idx: list[int]) -> np.ndarray:
        if name not in ds.data_vars:
            return np.full(len(at_idx), np.nan)
        return np.asarray(ds[name].isel(symbol=i).values)[at_idx]

    period_end = np.asarray(ds["period_end_date"].values)[traj_idx]
    revenue = col("revenue", traj_idx)
    cfo = col("cash_from_operations", traj_idx)
    capex = col("capital_expenditures", traj_idx)
    eps_a = col("eps_actual", traj_idx)
    eps_e = col("eps_estimate", traj_idx)
    wide_revenue = col("revenue", wide_idx)

    out: list[dict[str, Any]] = []
    for k in range(len(traj_idx)):
        wk = k + offset
        rev_yoy = None
        if wk - 4 >= 0:
            r_now, r_prior = wide_revenue[wk], wide_revenue[wk - 4]
            if np.isfinite(r_now) and np.isfinite(r_prior) and r_prior != 0:
                rev_yoy = float(r_now / r_prior - 1.0)
        fcf_margin = None
        if np.isfinite(cfo[k]) and np.isfinite(capex[k]) and np.isfinite(revenue[k]) and revenue[k] != 0:
            fcf_margin = float((cfo[k] - capex[k]) / revenue[k])
        surprise = None
        if np.isfinite(eps_a[k]) and np.isfinite(eps_e[k]) and np.isfinite(revenue[k]) and eps_e[k] != 0:
            surprise = float((eps_a[k] - eps_e[k]) / abs(eps_e[k]))
        out.append({
            "period_end_date": _iso_date(period_end[k]),
            "eps_surprise_pct": surprise,
            "revenue_yoy": rev_yoy,
            "fcf_margin": fcf_margin,
        })
    return out
