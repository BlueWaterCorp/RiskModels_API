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

# Design §2 noise-floor multipliers (tuned-from-traffic defaults).
# Return-attribution: |trade_effect| > k_R · σ_residual_monthly · √N_months.
# Variance-share attribution: |Δshare| > k_V · share_estimation_error.
NOISE_FLOOR_K_R = 1.5
NOISE_FLOOR_K_V = 2.0


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


def _build_narrative_v1(
    *,
    window: dict[str, Any],
    return_attribution: dict[str, Any],
    variance_share_attribution: dict[str, Any],
    coverage_in_erm3: float,
) -> str:
    """Template English for the M4 happy path (design §1 example shape).

    NarrativeEvaluator (THE_ANALYST.md §6) constraints enforced here:

    - **Grounded** — every claim reads a field already present in this response;
      no field invented from outside the kernel.
    - **Non-contradictory with noise floor** — the trade-effect claim is only
      made when `return_attribution.above_noise` is True. Below the floor the
      sentence explicitly says the move is inside noise; it does not name a
      lead position.
    - **§2 boundary** — descriptive past-tense only ("the book moved", "led
      by"); no recommendation verbs ("buy", "sell", "trim", "add", "should",
      "consider"). The lead-mover citation names the ticker but never the
      direction of the user's action.
    - **No-mock-data** — the lead-mover clause is gated on `top_contributors_by_trade`
      actually carrying a dominant entry (≥ 30% of |trade_effect_bps| AND ≥ 10bps
      absolute); a quiet rebalance produces no fabricated lead.
    - **Coverage-honest** — when `coverage_in_erm3 < 0.70`, the sentence opens
      "Of the X% of your book I model, …" rather than implying the result
      describes the whole portfolio.
    """
    from_d = window["from_date"]
    to_d = window["to_date"]
    total_pct = float(return_attribution["total_return_pct"])  # percent value
    trade_bps = int(return_attribution["trade_effect_bps"])
    market_bps = int(return_attribution["market_effect_bps"])
    noise_floor_bps = int(return_attribution["noise_floor_bps"])
    above_noise = bool(return_attribution["above_noise"])

    if coverage_in_erm3 < 0.70:
        cov_pct = int(round(coverage_in_erm3 * 100))
        opener = f"Of the {cov_pct}% of your book I model, the covered sleeve moved {total_pct:+.2f}%"
    else:
        opener = f"Your book moved {total_pct:+.2f}%"

    sentence_1 = f"{opener} from {from_d} to {to_d}."

    if above_noise:
        trade_clause = f"about {trade_bps:+d}bps came from rebalancing"
        market_clause = f"{market_bps:+d}bps from the market move"
        lead_clause = ""
        top_trade_list = return_attribution.get("top_contributors_by_trade") or []
        if top_trade_list:
            lead = top_trade_list[0]
            lead_bps = abs(int(lead.get("contribution_bps", 0)))
            if lead_bps >= 10 and lead_bps >= abs(trade_bps) * 0.30:
                lead_clause = f" (led by {lead['ticker']})"
        sentence_2 = f"{trade_clause}{lead_clause}, and {market_clause}."
        sentence_2 = sentence_2[0].upper() + sentence_2[1:]
    else:
        sentence_2 = (
            f"The trade effect ({trade_bps:+d}bps) was inside the ±{noise_floor_bps}bps "
            f"noise floor, so I can't tell rebalancing apart from natural variation."
        )

    sentences = [sentence_1, sentence_2]

    residual_change = variance_share_attribution.get("by_l3_bucket", {}).get("residual", {})
    if residual_change.get("above_noise"):
        delta_pp = float(residual_change["delta"]) * 100
        if delta_pp > 0:
            sentences.append(
                f"Residual variance share rose {abs(delta_pp):.1f}pp — the book's risk profile became more idiosyncratic."
            )
        else:
            sentences.append(
                f"Residual variance share fell {abs(delta_pp):.1f}pp — the book's risk profile became more systematic."
            )

    return " ".join(sentences)


def _variance_shares(
    monthly: xr.Dataset,
) -> dict[str, float]:
    """Compute the L3 variance-share attrs (matches D.8.22's `_variance_shares` math)."""

    def _v(da: xr.DataArray) -> float:
        return float(da.var(dim="teo", ddof=1).values) if da.size > 1 else 0.0

    v_m = _v(monthly["portfolio_market_return"])
    v_s = _v(monthly["portfolio_sector_return"])
    v_b = _v(monthly["portfolio_subsector_return"])
    # FF2 (v4) style leg — 0 when the segment kernel ran on pre-v4 ERM3.
    v_y = _v(monthly["portfolio_style_return"]) if "portfolio_style_return" in monthly else 0.0
    v_i = _v(monthly["portfolio_idiosyncratic_return"])
    v_t = v_m + v_s + v_b + v_y + v_i
    if v_t > 0 and np.isfinite(v_t):
        return {
            "market": v_m / v_t,
            "sector": v_s / v_t,
            "subsector": v_b / v_t,
            "style": v_y / v_t,
            "residual": v_i / v_t,
            "total_var": v_t,
            "total_vol_ann": float(np.sqrt(v_t * 12.0)),
            "n_obs": int(monthly.sizes["teo"]),
        }
    return {
        "market": 0.0,
        "sector": 0.0,
        "subsector": 0.0,
        "style": 0.0,
        "residual": 0.0,
        "total_var": 0.0,
        "total_vol_ann": 0.0,
        "n_obs": int(monthly.sizes["teo"]),
    }


def _compute_segment_returns(
    snapshots: list[PortfolioHistorySnapshot],
    ticker_to_symbol: dict[str, str],
    erm3_monthly: xr.Dataset,
) -> tuple[xr.Dataset, xr.Dataset, xr.DataArray, xr.DataArray, int, list[str], list[str]]:
    """Port of `Funds_DAG/compute/filer_returns.compute_filer_l3_returns`'s
    per-segment loop, adapted to read from a `portfolio_history` list rather
    than a `ds_ph` xr.Dataset. Also computes the static-w₀ counterfactual
    (weights frozen at the first snapshot) for trade-attribution.

    Returns
    -------
    actual : Dataset
        Per-month L3 components of the *actual* time-varying path.
    static : Dataset
        Per-month L3 components of the *static-w₀* counterfactual path.
        Same window/months as `actual`. Empty if only one snapshot.
    actual_contrib : DataArray (teo, symbol)
        Per-position gross-return contribution under the actual path.
    static_contrib : DataArray (teo, symbol)
        Per-position gross-return contribution under the static-w₀ path.
    n_holdings_typical : int
    dropped : list[str]  bridge misses
    joinable : list[str] ERM3 symbol ids covered (in the order used by *_contrib).
    """

    erm3_syms = set(str(s) for s in erm3_monthly["symbol"].values)
    erm3_teos = pd.DatetimeIndex(
        sorted(pd.Timestamp(t) for t in erm3_monthly["teo"].values)
    )
    empty = xr.Dataset()
    empty_da = xr.DataArray(np.zeros((0, 0)), dims=("teo", "symbol"))
    if len(erm3_teos) == 0:
        return empty, empty, empty_da, empty_da, 0, [], []

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
        return empty, empty, empty_da, empty_da, 0, dropped_all, []

    em = erm3_monthly.sel(symbol=joinable)
    gross_all = em["gross_return"]
    mkt_all = em["factor_return"].sel(level="market").drop_vars("level", errors="ignore")
    sec_all = em["factor_return"].sel(level="sector").drop_vars("level", errors="ignore")
    sub_all = em["factor_return"].sel(level="subsector").drop_vars("level", errors="ignore")
    # FF2 (v4) cascade: the subsector-level residual is style (SMB+HML) + the
    # stock-specific idio. When ERM3 emits the `stock_specific_l3` level, split
    # it — idio = stock_specific, style = subsector_resid − stock_specific — so
    # the decomposition matches the 5-leg identity
    # gross = market + sector + subsector + style + idio. Pre-v4 ERM3 (no
    # stock_specific_l3 level) → style ≡ 0 and idio = the subsector residual.
    sub_resid_all = (
        em["residual_return"].sel(level="subsector").drop_vars("level", errors="ignore")
    )
    _resid_levels = {str(lv) for lv in np.atleast_1d(em["residual_return"]["level"].values)}
    if "stock_specific_l3" in _resid_levels:
        idi_all = (
            em["residual_return"].sel(level="stock_specific_l3")
            .drop_vars("level", errors="ignore")
        )
        style_all = sub_resid_all - idi_all
    else:
        idi_all = sub_resid_all
        style_all = xr.zeros_like(sub_resid_all)
    last_erm3 = erm3_teos[-1]

    # w_0 = first snapshot's resolved weights, re-normalized on the joinable sleeve.
    w0_arr = np.array([snap_resolved[0][1].get(s, 0.0) for s in joinable], dtype=float)
    s_w0 = float(w0_arr.sum())
    if s_w0 > 0:
        w0_arr = w0_arr / s_w0
    w0_q = xr.DataArray(w0_arr, dims=("symbol",), coords={"symbol": joinable})

    chunks: list[xr.Dataset] = []
    chunks_static: list[xr.Dataset] = []
    contrib_chunks: list[xr.DataArray] = []
    contrib_chunks_static: list[xr.DataArray] = []
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

        # Slice once per component, fillna once, reuse for both paths.
        g_seg = gross_all.sel(teo=months.values).fillna(0.0)
        m_seg = mkt_all.sel(teo=months.values).fillna(0.0)
        sec_seg = sec_all.sel(teo=months.values).fillna(0.0)
        sub_seg = sub_all.sel(teo=months.values).fillna(0.0)
        style_seg = style_all.sel(teo=months.values).fillna(0.0)
        idi_seg = idi_all.sel(teo=months.values).fillna(0.0)

        # ── Actual path (time-varying weights = this segment's w_k) ───────────
        pg = (w_q * g_seg).sum("symbol")
        pm = (w_q * m_seg).sum("symbol")
        ps = (w_q * sec_seg).sum("symbol")
        pb = (w_q * sub_seg).sum("symbol")
        py = (w_q * style_seg).sum("symbol")
        pi = (w_q * idi_seg).sum("symbol")
        ir = pg - (pm + ps + pb + py + pi)

        valid = gross_all.sel(teo=months.values).notnull()
        weight_sum = (w_q * valid).sum("symbol")
        n_active = ((w_q > 0) & valid).sum("symbol").astype(np.int32)

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
                    "portfolio_style_return": py,
                    "portfolio_idiosyncratic_return": pi,
                    "identity_residual": ir,
                    "weight_sum": weight_sum,
                    "n_holdings_active": n_active,
                    "holding_quarter": hq,
                },
                coords={"teo": months.values},
            )
        )
        contrib_chunks.append((w_q * g_seg).transpose("teo", "symbol"))

        # ── Static-w₀ counterfactual (weights frozen at d_0) ──────────────────
        pg_s = (w0_q * g_seg).sum("symbol")
        pm_s = (w0_q * m_seg).sum("symbol")
        ps_s = (w0_q * sec_seg).sum("symbol")
        pb_s = (w0_q * sub_seg).sum("symbol")
        py_s = (w0_q * style_seg).sum("symbol")
        pi_s = (w0_q * idi_seg).sum("symbol")
        chunks_static.append(
            xr.Dataset(
                {
                    "portfolio_gross_return": pg_s,
                    "portfolio_market_return": pm_s,
                    "portfolio_sector_return": ps_s,
                    "portfolio_subsector_return": pb_s,
                    "portfolio_style_return": py_s,
                    "portfolio_idiosyncratic_return": pi_s,
                },
                coords={"teo": months.values},
            )
        )
        contrib_chunks_static.append((w0_q * g_seg).transpose("teo", "symbol"))

        n_holdings_typical_per_seg.append(int(np.count_nonzero(w_arr)))

    if not chunks:
        return empty, empty, empty_da, empty_da, 0, dropped_all, joinable

    out = xr.concat(chunks, dim="teo").sortby("teo")
    out = out.isel(teo=np.unique(out["teo"].values, return_index=True)[1]).load()

    out_static = xr.concat(chunks_static, dim="teo").sortby("teo")
    out_static = out_static.isel(
        teo=np.unique(out_static["teo"].values, return_index=True)[1]
    ).load()

    contrib_actual = xr.concat(contrib_chunks, dim="teo").sortby("teo").load()
    contrib_actual = contrib_actual.isel(
        teo=np.unique(contrib_actual["teo"].values, return_index=True)[1]
    )
    contrib_static = xr.concat(contrib_chunks_static, dim="teo").sortby("teo").load()
    contrib_static = contrib_static.isel(
        teo=np.unique(contrib_static["teo"].values, return_index=True)[1]
    )

    return (
        out,
        out_static,
        contrib_actual,
        contrib_static,
        int(np.median(n_holdings_typical_per_seg)) if n_holdings_typical_per_seg else 0,
        sorted(set(dropped_all)),
        joinable,
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

    (
        monthly,
        monthly_static,
        contrib_actual,
        contrib_static,
        n_typ,
        dropped,
        joinable,
    ) = _compute_segment_returns(snapshots, ticker_to_symbol, erm3_monthly)
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
    # FF2 (v4) style leg — SMB+HML is a systematic factor, so its variance joins
    # the systematic share (not residual). 0 when the kernel ran on pre-v4 ERM3.
    py = (monthly["portfolio_style_return"].values
          if "portfolio_style_return" in monthly
          else np.zeros(n_m, dtype=float))
    pi = monthly["portfolio_idiosyncratic_return"].values
    sys_share_series: list[float] = []
    res_share_series: list[float] = []
    for j in range(1, n_m + 1):
        v_m = float(np.var(pm[:j], ddof=1)) if j > 1 else 0.0
        v_s = float(np.var(ps[:j], ddof=1)) if j > 1 else 0.0
        v_b = float(np.var(pb[:j], ddof=1)) if j > 1 else 0.0
        v_y = float(np.var(py[:j], ddof=1)) if j > 1 else 0.0
        v_i = float(np.var(pi[:j], ddof=1)) if j > 1 else 0.0
        v_t = v_m + v_s + v_b + v_y + v_i
        if v_t > 0:
            sys_share_series.append((v_m + v_s + v_b + v_y) / v_t)
            res_share_series.append(v_i / v_t)
        else:
            sys_share_series.append(0.0)
            res_share_series.append(0.0)

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    window_days = (pd.Timestamp(snapshots[-1].as_of_date) - pd.Timestamp(snapshots[0].as_of_date)).days
    frequency_used = (
        "daily" if window_days <= DAILY_MONTHLY_BOUNDARY_DAYS else "monthly"
    )

    # ── Return attribution (design §1a) ─────────────────────────────────────
    # Actual = compound of <w_k(t), r_t> across months (time-varying weights).
    # Static = compound of <w_0, r_t> across months (frozen at the first
    # snapshot's weights). trade_effect = actual − static.
    actual_gross = monthly["portfolio_gross_return"].values
    actual_market = monthly["portfolio_market_return"].values
    static_gross = monthly_static["portfolio_gross_return"].values
    total_return_pct = float((1 + actual_gross).prod() - 1) * 100
    static_return_pct = float((1 + static_gross).prod() - 1) * 100
    market_return_pct = float((1 + actual_market).prod() - 1) * 100
    trade_effect_pct = total_return_pct - static_return_pct

    # Per-bucket attribution. Trade-effect per bucket = (actual − static) for
    # that L3 slice, in cumulative-sum terms (component contributions sum, not
    # compound, since the identity gross ≈ market+sector+sub+idio is additive
    # in monthly contributions and the question we're answering is "how many
    # bps did each bucket contribute").
    bucket_keys = ("market", "sector", "subsector", "style", "residual")
    bucket_var_names = {
        "market": "portfolio_market_return",
        "sector": "portfolio_sector_return",
        "subsector": "portfolio_subsector_return",
        "style": "portfolio_style_return",
        "residual": "portfolio_idiosyncratic_return",
    }
    by_l3_bucket: dict[str, dict[str, int]] = {}
    for bk in bucket_keys:
        actual_sum = float(monthly[bucket_var_names[bk]].values.sum())
        static_sum = float(monthly_static[bucket_var_names[bk]].values.sum())
        by_l3_bucket[bk] = {
            "actual_bps": int(round(actual_sum * 10000)),
            "static_bps": int(round(static_sum * 10000)),
            "trade_effect_bps": int(round((actual_sum - static_sum) * 10000)),
        }

    # Per-position trade and static contributions for top-contributors.
    symbol_to_ticker = {v: k for k, v in ticker_to_symbol.items()}
    actual_sum_per_sym = contrib_actual.sum(dim="teo").values  # (n_syms,)
    static_sum_per_sym = contrib_static.sum(dim="teo").values
    trade_sum_per_sym = actual_sum_per_sym - static_sum_per_sym

    def _top_n(per_sym_values: np.ndarray, n: int = 5) -> list[dict[str, Any]]:
        if per_sym_values.size == 0:
            return []
        order = np.argsort(-np.abs(per_sym_values))[:n]
        out: list[dict[str, Any]] = []
        for idx in order:
            sym = joinable[int(idx)]
            v = float(per_sym_values[int(idx)])
            if not np.isfinite(v) or abs(v) < 1e-8:
                continue
            out.append(
                {
                    "ticker": symbol_to_ticker.get(sym, sym),
                    "symbol": sym,
                    "contribution_bps": int(round(v * 10000)),
                }
            )
        return out

    top_static = _top_n(static_sum_per_sym)
    top_trade = _top_n(trade_sum_per_sym)

    # Design §2 noise floor: |trade_effect| > k_R · σ_residual_monthly · √N.
    idio_monthly = monthly["portfolio_idiosyncratic_return"].values
    if len(idio_monthly) >= 2:
        sigma_res_monthly = float(np.std(idio_monthly, ddof=1))
        noise_threshold = NOISE_FLOOR_K_R * sigma_res_monthly * float(np.sqrt(len(idio_monthly)))
    else:
        sigma_res_monthly = 0.0
        noise_threshold = 0.0
    noise_floor_bps = int(round(noise_threshold * 10000))
    trade_effect_bps_int = int(round(trade_effect_pct * 100))
    above_noise = abs(trade_effect_bps_int) > noise_floor_bps

    return_attribution = {
        "total_return_pct": round(total_return_pct, 4),
        "static_return_pct": round(static_return_pct, 4),
        "trade_effect_bps": trade_effect_bps_int,
        "market_effect_bps": int(round(market_return_pct * 100)),
        "interaction_total_bps": 0,  # exact decomposition: actual = static + trade
        "by_l3_bucket": by_l3_bucket,
        "noise_floor_bps": noise_floor_bps,
        "above_noise": above_noise,
        "top_contributors_by_trade": top_trade,
        "top_contributors_static": top_static,
    }

    # ── Variance-share attribution (design §1b) ─────────────────────────────
    # Compare variance shares under the actual path vs the static-w₀ path. The
    # difference is the share of variance attributable to rebalancing. Per
    # position: marginal change in monthly contribution variance.
    static_vs = _variance_shares(monthly_static)
    n_months = int(monthly.sizes["teo"])
    share_est_err = float(np.sqrt(2.0 / n_months)) if n_months >= 4 else 1.0
    share_noise_floor = NOISE_FLOOR_K_V * share_est_err
    share_changes_by_bucket: dict[str, dict[str, float]] = {}
    for bk in ("market", "sector", "subsector", "residual"):
        delta = float(full_vs[bk] - static_vs[bk])
        share_changes_by_bucket[bk] = {
            "actual_share": round(float(full_vs[bk]), 6),
            "static_share": round(float(static_vs[bk]), 6),
            "delta": round(delta, 6),
            "above_noise": abs(delta) > share_noise_floor,
        }

    # Per-position marginal variance change. For each position s:
    #   marginal_var_change[s] = var(contrib_actual[s, :]) − var(contrib_static[s, :])
    # which measures how rebalancing changed that position's contribution
    # volatility. Sort by |marginal_var_change|, top N.
    if contrib_actual.sizes.get("teo", 0) >= 2:
        var_actual_per_sym = contrib_actual.var(dim="teo", ddof=1).values
        var_static_per_sym = contrib_static.var(dim="teo", ddof=1).values
        marginal_var_change = var_actual_per_sym - var_static_per_sym
        order = np.argsort(-np.abs(marginal_var_change))[:5]
        top_var_contributors: list[dict[str, Any]] = []
        for idx in order:
            sym = joinable[int(idx)]
            v = float(marginal_var_change[int(idx)])
            if not np.isfinite(v) or abs(v) < 1e-12:
                continue
            top_var_contributors.append(
                {
                    "ticker": symbol_to_ticker.get(sym, sym),
                    "symbol": sym,
                    "var_change": round(v, 8),
                }
            )
    else:
        top_var_contributors = []

    variance_share_attribution = {
        "by_l3_bucket": share_changes_by_bucket,
        "noise_floor_share": round(share_noise_floor, 6),
        "n_months": n_months,
        "top_contributors_by_variance_change": top_var_contributors,
    }

    window_block = {
        "from_date": snapshots[0].as_of_date,
        "to_date": snapshots[-1].as_of_date,
        "n_dated_points": len(snapshots),
        "frequency_used": frequency_used,
        "truncated_window": False,
    }
    narrative_v1 = _build_narrative_v1(
        window=window_block,
        return_attribution=return_attribution,
        variance_share_attribution=variance_share_attribution,
        coverage_in_erm3=coverage_in_erm3,
    )

    response: dict[str, Any] = {
        "portfolio_id": portfolio_id,
        "window": window_block,
        "return_attribution": return_attribution,
        "variance_share_evolution": {
            "teo": teo_vals,
            "systematic_share": [round(x, 6) for x in sys_share_series],
            "residual_share": [round(x, 6) for x in res_share_series],
        },
        "variance_share_attribution": variance_share_attribution,
        "narrative_v1": narrative_v1,
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
                    "portfolio_style_return": (
                        float(monthly["portfolio_style_return"].values[k])
                        if "portfolio_style_return" in monthly else 0.0
                    ),
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
