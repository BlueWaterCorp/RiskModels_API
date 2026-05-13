"""The Analyst M4 — `/portfolio-evolution` kernel.

Reads a client portfolio's dated holdings history (`CmlPortfolioSnapshot[]` from
`cml_activation_state.portfolio_history`, M3c) and joins against ERM3 monthly
L3 returns to produce the "what changed" decomposition the deck/chat surface.

**Design:** [`BWMACRO/docs/cursor_plans/the_analyst_m4_design.md`](../../../../../BWMACRO/docs/cursor_plans/the_analyst_m4_design.md).
**Math reference:** ports the constant-holdings-within-segment semantics from
`Funds_DAG/src/funds_dag/compute/filer_returns.py::compute_filer_l3_returns`
(D.8.22) — the same kernel that produced the 13F filer ground truth this
endpoint's tests verify against.

**Scope (this PR-1 module):**

- Resolves the holdings' tickers → ERM3 symbol ids via a caller-provided bridge
  (production endpoint wires it to the secmaster; tests construct it from the
  local ERM3 zarr's `ticker` coord).
- Applies the `uni_mc_3000` filter at read time (drops cash, ETFs, bonds, OTC,
  any ticker not in the bridge); renormalizes weights to 100% on the covered
  single-name sleeve.
- Per the design doc's §1a math: for each inter-snapshot segment `[d_k, d_{k+1})`,
  weights are held at the `d_k` snapshot; for each month-end in the segment, the
  portfolio's L3 component returns are weighted sums over the bridge-mapped
  holdings. Same constant-holdings-within-segment semantics D.8.22 uses for
  13F quarters.
- Emits the JSON shape from §5 of the design doc (return + variance-share paths
  + edge-case shapes + `_metadata`).

**Deferred to follow-on commits in this PR:**

- The trade-attribution path (`return_attribution.trade_effect_bps` and the
  per-position `top_contributors_by_trade`). Stub-zero for now — 13F filers
  hold quarter-constant weights, so the golden-master tests don't exercise it.
- The variance-share-attribution path (finite-difference on the L3 covariance
  functional). Stub-empty for now; the variance-share *evolution* (the
  time-series) is populated.
- The noise-floor enforcement (`above_noise` per slice). Stub-true for now.
- The editorial `narrative_v1` (template English). Stub-string for now.
- The `include_full_breakdown` query-param path. Default-only for now.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable

import numpy as np
import pandas as pd
import xarray as xr


logger = logging.getLogger(__name__)

KERNEL_VERSION = "m4.v1.2026-05-13"

# Length-of-window cutoff between daily and monthly ERM3 returns (design §4).
DAILY_MONTHLY_BOUNDARY_DAYS = 30


@dataclass(frozen=True)
class PortfolioHistorySnapshot:
    """Subset of M3c's `CmlPortfolioSnapshot` the kernel actually needs."""

    as_of_date: str  # ISO YYYY-MM-DD
    holdings: list[dict[str, Any]]  # [{ticker, weight?, shares?}, ...]
    ingest_adapter: str = "paste"


def _parse_snapshots(raw: Iterable[dict[str, Any]]) -> list[PortfolioHistorySnapshot]:
    """Defensive dedup-by-`as_of_date` (last-write-wins) + sort oldest→newest.

    M3c's `appendPortfolioSnapshot` already enforces this on the write path;
    the kernel re-applies it as belt-and-suspenders (catches an M3c regression).
    """
    by_date: dict[str, PortfolioHistorySnapshot] = {}
    n_dup = 0
    for r in raw:
        d = r.get("as_of_date")
        if not d:
            continue
        h = r.get("holdings") or []
        if not h:
            continue
        if d in by_date:
            n_dup += 1
        by_date[d] = PortfolioHistorySnapshot(
            as_of_date=d,
            holdings=h,
            ingest_adapter=r.get("ingest_adapter", "paste"),
        )
    if n_dup:
        logger.warning(
            "portfolio_history had %d duplicate as_of_date row(s) — M3c write-path regression?",
            n_dup,
        )
    return sorted(by_date.values(), key=lambda s: s.as_of_date)


def _resolve_holdings(
    snapshot: PortfolioHistorySnapshot,
    ticker_to_symbol: dict[str, str],
) -> tuple[dict[str, float], list[str]]:
    """Resolve the snapshot's holdings to ERM3 symbol ids, renormalize weights to 1.0
    on the covered sleeve, and return both the (symbol → weight) map and the list
    of *dropped* (non-ERM3, non-bridged) tickers (for coverage reporting)."""

    raw_weights: dict[str, float] = {}
    dropped: list[str] = []
    for h in snapshot.holdings:
        t = (h.get("ticker") or "").strip().upper()
        if not t:
            continue
        w = h.get("weight")
        if w is None and h.get("shares") is not None:
            # Shares mode without prices — fall back to count-equal weight per share.
            # The caller can supply weight-mode input for sharper attribution; this
            # is the v1 honest fallback (matches M3a's coverage-on-the-covered-sleeve
            # discipline).
            w = float(h["shares"])
        if w is None or float(w) <= 0:
            continue
        sym = ticker_to_symbol.get(t)
        if not sym:
            dropped.append(t)
            continue
        raw_weights[sym] = raw_weights.get(sym, 0.0) + float(w)

    total = sum(raw_weights.values())
    if total <= 0:
        return {}, dropped
    norm = {s: w / total for s, w in raw_weights.items()}
    return norm, dropped


def _empty_response(
    portfolio_id: str,
    reason: str,
    *,
    n_snapshots: int,
    coverage_in_erm3: float = 0.0,
) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return {
        "portfolio_id": portfolio_id,
        "window": {
            "from_date": None,
            "to_date": None,
            "n_dated_points": n_snapshots,
            "frequency_used": "monthly",
            "truncated_window": False,
        },
        "return_attribution": None,
        "variance_share_evolution": {"teo": [], "systematic_share": [], "residual_share": []},
        "variance_share_attribution": None,
        "narrative_v1": _empty_narrative(reason, n_snapshots),
        "_metadata": {
            "kernel_version": KERNEL_VERSION,
            "generated_at": now,
            "data_as_of": None,
            "n_holdings": 0,
            "coverage_in_erm3": coverage_in_erm3,
            "low_coverage": True,
            "empty_reason": reason,
        },
    }


def _empty_narrative(reason: str, n_snapshots: int) -> str:
    if reason == "single_point":
        return "First snapshot recorded — come back after your next update and I'll show what changed."
    if reason == "no_erm3_overlap":
        return (
            "No ERM3-covered holdings to decompose — this view models individual US equities; "
            "an ETF-heavy book would need the M4.5 look-through view (not yet wired)."
        )
    if reason == "window_too_short":
        return "Window too short for an attribution story — try a longer span between snapshots."
    return f"Cannot build a what-changed view yet ({reason})."


def _variance_shares(
    monthly: xr.Dataset,
) -> dict[str, float]:
    """Compute the L3 variance-share attrs (matches D.8.22's `_variance_shares` math)."""

    def _v(da: xr.DataArray) -> float:
        return float(da.var(dim="teo", ddof=1).values) if da.size > 1 else 0.0

    v_m = _v(monthly["portfolio_market_return"])
    v_s = _v(monthly["portfolio_sector_return"])
    v_b = _v(monthly["portfolio_subsector_return"])
    v_i = _v(monthly["portfolio_idiosyncratic_return"])
    v_t = v_m + v_s + v_b + v_i
    if v_t > 0 and np.isfinite(v_t):
        return {
            "market": v_m / v_t,
            "sector": v_s / v_t,
            "subsector": v_b / v_t,
            "residual": v_i / v_t,
            "total_var": v_t,
            "total_vol_ann": float(np.sqrt(v_t * 12.0)),
            "n_obs": int(monthly.sizes["teo"]),
        }
    return {
        "market": 0.0,
        "sector": 0.0,
        "subsector": 0.0,
        "residual": 0.0,
        "total_var": 0.0,
        "total_vol_ann": 0.0,
        "n_obs": int(monthly.sizes["teo"]),
    }


def _compute_segment_returns(
    snapshots: list[PortfolioHistorySnapshot],
    ticker_to_symbol: dict[str, str],
    erm3_monthly: xr.Dataset,
) -> tuple[xr.Dataset, int, list[str]]:
    """Port of `Funds_DAG/compute/filer_returns.compute_filer_l3_returns`'s
    per-segment loop, adapted to read from a `portfolio_history` list rather
    than a `ds_ph` xr.Dataset.

    Returns `(monthly_returns_ds, n_holdings_typical, dropped_tickers_all)`.
    """

    erm3_syms = set(str(s) for s in erm3_monthly["symbol"].values)
    erm3_teos = pd.DatetimeIndex(
        sorted(pd.Timestamp(t) for t in erm3_monthly["teo"].values)
    )
    if len(erm3_teos) == 0:
        return xr.Dataset(), 0, []

    # Pre-slice ERM3 to the union of bridge-mapped symbols across all snapshots.
    needed_syms: set[str] = set()
    snap_resolved: list[tuple[str, dict[str, float], list[str]]] = []
    dropped_all: list[str] = []
    for s in snapshots:
        weights, dropped = _resolve_holdings(s, ticker_to_symbol)
        snap_resolved.append((s.as_of_date, weights, dropped))
        needed_syms.update(weights.keys())
        dropped_all.extend(dropped)

    joinable = sorted(needed_syms & erm3_syms)
    if not joinable:
        return xr.Dataset(), 0, dropped_all

    em = erm3_monthly.sel(symbol=joinable)
    gross_all = em["gross_return"]
    mkt_all = em["factor_return"].sel(level="market").drop_vars("level", errors="ignore")
    sec_all = em["factor_return"].sel(level="sector").drop_vars("level", errors="ignore")
    sub_all = em["factor_return"].sel(level="subsector").drop_vars("level", errors="ignore")
    idi_all = (
        em["residual_return"].sel(level="subsector").drop_vars("level", errors="ignore")
    )
    last_erm3 = erm3_teos[-1]

    chunks: list[xr.Dataset] = []
    n_holdings_typical_per_seg: list[int] = []

    for i, (d_k, weights, _dropped) in enumerate(snap_resolved):
        d_kp1 = pd.Timestamp(snap_resolved[i + 1][0]) if i + 1 < len(snap_resolved) else last_erm3
        d_k_ts = pd.Timestamp(d_k)

        # Months strictly after d_k, up to and including d_kp1 (last segment
        # runs forward to the latest ERM3 monthly teo).
        months = erm3_teos[(erm3_teos > d_k_ts) & (erm3_teos <= d_kp1)]
        if i + 1 == len(snap_resolved):
            months = erm3_teos[erm3_teos > d_k_ts]
        if len(months) == 0:
            continue

        # Build the w-vector over `joinable` for this segment.
        w_arr = np.array([weights.get(s, 0.0) for s in joinable], dtype=float)
        # Re-normalize to 1.0 on the joinable sleeve (some snapshot weights may
        # have referenced symbols that *were* in the bridge but aren't in the
        # current ERM3 universe — drop and renormalize).
        s_w = float(w_arr.sum())
        if s_w <= 0:
            continue
        w_arr = w_arr / s_w
        w_q = xr.DataArray(w_arr, dims=("symbol",), coords={"symbol": joinable})

        def _port(comp: xr.DataArray) -> xr.DataArray:
            c = comp.sel(teo=months.values)
            return (w_q * c.fillna(0.0)).sum("symbol")

        valid = gross_all.sel(teo=months.values).notnull()
        weight_sum = (w_q * valid).sum("symbol")
        n_active = ((w_q > 0) & valid).sum("symbol").astype(np.int32)

        pg = _port(gross_all)
        pm = _port(mkt_all)
        ps = _port(sec_all)
        pb = _port(sub_all)
        pi = _port(idi_all)
        ir = pg - (pm + ps + pb + pi)

        hq = xr.DataArray(
            np.full(len(months), np.datetime64(d_k_ts), dtype="datetime64[ns]"),
            dims=("teo",),
            coords={"teo": months.values},
        )
        chunks.append(
            xr.Dataset(
                {
                    "portfolio_gross_return": pg,
                    "portfolio_market_return": pm,
                    "portfolio_sector_return": ps,
                    "portfolio_subsector_return": pb,
                    "portfolio_idiosyncratic_return": pi,
                    "identity_residual": ir,
                    "weight_sum": weight_sum,
                    "n_holdings_active": n_active,
                    "holding_quarter": hq,
                },
                coords={"teo": months.values},
            )
        )
        n_holdings_typical_per_seg.append(int(np.count_nonzero(w_arr)))

    if not chunks:
        return xr.Dataset(), 0, dropped_all

    out = xr.concat(chunks, dim="teo").sortby("teo")
    # Drop any duplicate teo (shouldn't happen with disjoint segments).
    out = out.isel(teo=np.unique(out["teo"].values, return_index=True)[1])
    out = out.load()
    return (
        out,
        int(np.median(n_holdings_typical_per_seg)) if n_holdings_typical_per_seg else 0,
        sorted(set(dropped_all)),
    )


def compute_portfolio_evolution(
    portfolio_history: list[dict[str, Any]],
    *,
    portfolio_id: str,
    erm3_monthly: xr.Dataset,
    ticker_to_symbol: dict[str, str],
    include_full_breakdown: bool = False,
) -> dict[str, Any]:
    """Top-level kernel. Returns the M4 response shape (design doc §5).

    Edge-case shapes per §5b: 1-point → `return_attribution: null`; no ERM3
    overlap → `above_noise: false` everywhere + decline narrative;
    low coverage → still compute on the covered sleeve, flag in `_metadata`.
    """

    snapshots = _parse_snapshots(portfolio_history)
    if len(snapshots) == 0:
        return _empty_response(portfolio_id, "no_snapshots", n_snapshots=0)
    if len(snapshots) == 1:
        return _empty_response(portfolio_id, "single_point", n_snapshots=1)

    monthly, n_typ, dropped = _compute_segment_returns(
        snapshots, ticker_to_symbol, erm3_monthly
    )
    if monthly.sizes.get("teo", 0) == 0:
        # No symbol overlap — typical when the book is all ETFs/cash/bonds.
        n_total = sum(len(s.holdings) for s in snapshots) / max(len(snapshots), 1)
        cov = 1.0 - (len(dropped) / max(n_total, 1)) if n_total > 0 else 0.0
        return _empty_response(
            portfolio_id, "no_erm3_overlap", n_snapshots=len(snapshots), coverage_in_erm3=cov
        )

    # Coverage of the typical snapshot.
    n_total_typical = int(
        np.median([len(s.holdings) for s in snapshots]) if snapshots else 0
    )
    coverage_in_erm3 = n_typ / max(n_total_typical, 1) if n_total_typical > 0 else 0.0

    full_vs = _variance_shares(monthly)
    n_m = int(monthly.sizes["teo"])
    rn = min(12, n_m)
    if rn >= 4:
        recent = _variance_shares(monthly.isel(teo=slice(-rn, None)))
    else:
        recent = dict(full_vs)

    # Variance-share evolution time series — systematic vs residual per the design.
    teo_vals = [pd.Timestamp(t).strftime("%Y-%m-%d") for t in monthly["teo"].values]

    # Per-period systematic share = (mkt + sec + sub) / (gross-of-idio); we
    # report a *rolling* share over a small window to surface trajectory rather
    # than per-month noise. v1: use the cumulative-from-start share, mirroring
    # how the chat will narrate "since you last looked".
    pm = monthly["portfolio_market_return"].values
    ps = monthly["portfolio_sector_return"].values
    pb = monthly["portfolio_subsector_return"].values
    pi = monthly["portfolio_idiosyncratic_return"].values
    sys_share_series: list[float] = []
    res_share_series: list[float] = []
    for j in range(1, n_m + 1):
        v_m = float(np.var(pm[:j], ddof=1)) if j > 1 else 0.0
        v_s = float(np.var(ps[:j], ddof=1)) if j > 1 else 0.0
        v_b = float(np.var(pb[:j], ddof=1)) if j > 1 else 0.0
        v_i = float(np.var(pi[:j], ddof=1)) if j > 1 else 0.0
        v_t = v_m + v_s + v_b + v_i
        if v_t > 0:
            sys_share_series.append((v_m + v_s + v_b) / v_t)
            res_share_series.append(v_i / v_t)
        else:
            sys_share_series.append(0.0)
            res_share_series.append(0.0)

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    window_days = (pd.Timestamp(snapshots[-1].as_of_date) - pd.Timestamp(snapshots[0].as_of_date)).days
    frequency_used = (
        "daily" if window_days <= DAILY_MONTHLY_BOUNDARY_DAYS else "monthly"
    )

    # Compute totals for the convenience fields.
    total_return_pct = float((1 + monthly["portfolio_gross_return"].values).prod() - 1) * 100
    market_return_pct = float((1 + monthly["portfolio_market_return"].values).prod() - 1) * 100

    # PR-1 follow-up: trade-attribution + variance-share-attribution paths.
    # 13F-derived test fixtures hold weights constant within quarter →
    # trade_effect_bps must be ~0; v1 stubs to 0 explicitly. Real-client
    # within-quarter weight changes (Plaid / paste-repeat-with-different-input)
    # will exercise these in the follow-on commit.
    return_attribution = {
        "total_return_pct": round(total_return_pct, 4),
        "static_return_pct": round(total_return_pct, 4),  # = total for constant-holdings inputs
        "trade_effect_bps": 0,  # stub — see follow-up
        "market_effect_bps": int(round(market_return_pct * 100)),
        "interaction_total_bps": 0,
        "by_l3_bucket": {},  # follow-up
        "noise_floor_bps": 0,  # follow-up
        "above_noise": True,  # follow-up
        "top_contributors_by_trade": [],
        "top_contributors_static": [],
    }

    response: dict[str, Any] = {
        "portfolio_id": portfolio_id,
        "window": {
            "from_date": snapshots[0].as_of_date,
            "to_date": snapshots[-1].as_of_date,
            "n_dated_points": len(snapshots),
            "frequency_used": frequency_used,
            "truncated_window": False,
        },
        "return_attribution": return_attribution,
        "variance_share_evolution": {
            "teo": teo_vals,
            "systematic_share": [round(x, 6) for x in sys_share_series],
            "residual_share": [round(x, 6) for x in res_share_series],
        },
        "variance_share_attribution": None,  # follow-up
        "narrative_v1": "",  # follow-up — template English layer
        "_metadata": {
            "kernel_version": KERNEL_VERSION,
            "generated_at": now,
            "data_as_of": teo_vals[-1] if teo_vals else None,
            "n_holdings": n_typ,
            "coverage_in_erm3": round(coverage_in_erm3, 4),
            "low_coverage": coverage_in_erm3 < 0.70,
            "dropped_tickers": dropped,  # for QA — top-N or full depending on caller
            "variance_shares_full_history": {
                "market": round(full_vs["market"], 6),
                "sector": round(full_vs["sector"], 6),
                "subsector": round(full_vs["subsector"], 6),
                "residual": round(full_vs["residual"], 6),
                "total_var": full_vs["total_var"],
                "total_vol_ann": full_vs["total_vol_ann"],
                "n_obs": full_vs["n_obs"],
            },
            "variance_shares_recent_12m": {
                "market": round(recent["market"], 6),
                "sector": round(recent["sector"], 6),
                "subsector": round(recent["subsector"], 6),
                "residual": round(recent["residual"], 6),
                "n_obs": recent["n_obs"],
            },
        },
        "_monthly_breakdown": (
            [
                {
                    "teo": pd.Timestamp(monthly["teo"].values[k]).strftime("%Y-%m-%d"),
                    "portfolio_gross_return": float(monthly["portfolio_gross_return"].values[k]),
                    "portfolio_market_return": float(monthly["portfolio_market_return"].values[k]),
                    "portfolio_sector_return": float(monthly["portfolio_sector_return"].values[k]),
                    "portfolio_subsector_return": float(monthly["portfolio_subsector_return"].values[k]),
                    "portfolio_idiosyncratic_return": float(
                        monthly["portfolio_idiosyncratic_return"].values[k]
                    ),
                    "identity_residual": float(monthly["identity_residual"].values[k]),
                    "weight_sum": float(monthly["weight_sum"].values[k]),
                    "n_holdings_active": int(monthly["n_holdings_active"].values[k]),
                    "holding_quarter": pd.Timestamp(monthly["holding_quarter"].values[k]).strftime(
                        "%Y-%m-%d"
                    ),
                }
                for k in range(n_m)
            ]
            if include_full_breakdown
            else None
        ),
    }
    if not include_full_breakdown:
        response.pop("_monthly_breakdown", None)
    return response


__all__ = [
    "KERNEL_VERSION",
    "compute_portfolio_evolution",
]
