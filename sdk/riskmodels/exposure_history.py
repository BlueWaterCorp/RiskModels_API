"""Exposure history: join the model data feed with your dated holdings, locally.

``client.exposure_history(tickers)`` downloads each name's month-end ERM3 history
and the ETF covariance at each month-end (POST /portfolio/exposure/history).
Only tickers are sent — no values — so your holdings never leave this machine.
:meth:`ExposureHistoryPack.exposure` then computes, at each month-end, the same
quantities as POST /portfolio/exposure for the book you held at that date.

The math is a port of ``lib/portfolio/signed-exposure.ts`` and is pinned to it
by a shared fixture (``tests/fixtures/signed_exposure_parity.json``):

- hedge ratio ``hr`` = ETF dollars per $1 long stock; stock hedge trade
  ``H_e = Σ v·hr``; ETF exposure ``x = -H + d`` (``d`` = ETFs held directly);
- systematic daily variance ``xᵀΣx``; layer contributions ``x_Lᵀ Σ x`` sum to it;
- residual daily variance ``Σ v²·stock_var·max(lK_res_er, 0)`` at each name's
  level K — a diagonal approximation that ignores residual covariance across
  names. A residual share above 1 (the hedge added variance) is used as is and
  reported in ``hedge_added_variance``;
- default basis ``"lstar"`` (each name at its own L* level, no fallback);
  ``"l1"`` / ``"l2"`` / ``"l3"`` force one level;
- volatility annualised with √252.
"""

from __future__ import annotations

import io
import math
import warnings
from dataclasses import dataclass, field
from typing import Any, Literal, Mapping

import numpy as np
import pandas as pd

Basis = Literal["lstar", "l1", "l2", "l3"]
LEVELS = ("l1", "l2", "l3")
MARKET_ETF = "SPY"
TRADING_DAYS = 252
HEDGE_ADDED_EPS = 1e-6


def _finite(v: Any) -> bool:
    return isinstance(v, (int, float, np.floating)) and math.isfinite(float(v))


def stock_legs(m: Mapping[str, Any], sector: str | None, subsector: str | None, level: str):
    """ETF legs [(etf, layer, hr)] for one name at one level, or None when any leg is missing."""
    if level == "l1":
        return [(MARKET_ETF, "market", float(m["l1_mkt_hr"]))] if _finite(m.get("l1_mkt_hr")) else None
    if level == "l2":
        if not sector or not (_finite(m.get("l2_mkt_hr")) and _finite(m.get("l2_sec_hr"))):
            return None
        return [(MARKET_ETF, "market", float(m["l2_mkt_hr"])), (sector, "sector", float(m["l2_sec_hr"]))]
    sub = subsector or sector
    if not sector or not sub or not all(_finite(m.get(k)) for k in ("l3_mkt_hr", "l3_sec_hr", "l3_sub_hr")):
        return None
    return [
        (MARKET_ETF, "market", float(m["l3_mkt_hr"])),
        (sector, "sector", float(m["l3_sec_hr"])),
        (sub, "subsector", float(m["l3_sub_hr"])),
    ]


def resolve_level(m, sector, subsector, basis: Basis) -> tuple[str | None, str | None]:
    """(level, exclusion reason). Mirrors resolveLevel in signed-exposure.ts."""
    if basis != "lstar":
        return basis, None
    ls = m.get("lstar_level")
    if not _finite(ls) or not 1 <= float(ls) <= 3:
        return None, "no_lstar"
    level = f"l{int(round(float(ls)))}"
    usable = stock_legs(m, sector, subsector, level) is not None and _finite(m.get(f"{level}_res_er"))
    return (level, None) if usable else (None, "lstar_level_incomplete")


def compute_signed_exposure(
    stocks: list[dict],
    direct_etfs: Mapping[str, float],
    input_gross_usd: float,
    etfs: list[str] | None,
    S: np.ndarray | None,
    basis: Basis = "lstar",
) -> dict:
    """One date. ``stocks``: dicts with ticker, value, sector_etf, subsector_etf, metrics.

    ``etfs`` / ``S``: covariance axes and the daily covariance matrix (NaN = unavailable).
    """
    gross = input_gross_usd
    share = (lambda c: c / gross) if gross > 0 else (lambda c: None)
    idx = {e: i for i, e in enumerate(etfs or [])}

    # beta-dollars
    stock_beta = beta_cov = 0.0
    for s in stocks:
        b = s["metrics"].get("l1_mkt_beta")
        if _finite(b):
            stock_beta += s["value"] * float(b)
            beta_cov += abs(s["value"])
    direct_beta = direct_beta_cov = 0.0
    spy = idx.get(MARKET_ETF)
    for t, v in direct_etfs.items():
        beta = None
        if t == MARKET_ETF:
            beta = 1.0
        elif S is not None and spy is not None and t in idx and _finite(S[spy, spy]) and S[spy, spy] > 0:
            c = S[idx[t], spy]
            beta = float(c / S[spy, spy]) if _finite(c) else None
        if beta is not None:
            direct_beta += v * beta
            direct_beta_cov += abs(v)

    # per-name level and the basis hedge
    level_of: dict[int, str] = {}
    counts = {lv: 0 for lv in LEVELS}
    excluded = []
    for i, s in enumerate(stocks):
        lv, why = resolve_level(s["metrics"], s.get("sector_etf"), s.get("subsector_etf"), basis)
        if lv:
            level_of[i] = lv
            counts[lv] += 1
        if why:
            excluded.append({"ticker": s["ticker"], "value_usd": s["value"], "reason": why})

    hedge: dict[str, float] = {}
    hedge_cov = 0.0
    for i, s in enumerate(stocks):
        lv = level_of.get(i)
        legs = stock_legs(s["metrics"], s.get("sector_etf"), s.get("subsector_etf"), lv) if lv else None
        if not legs:
            continue
        hedge_cov += abs(s["value"])
        for etf, _, hr in legs:
            hedge[etf] = hedge.get(etf, 0.0) + s["value"] * hr
    neutralizing = dict(hedge)
    for t, v in direct_etfs.items():
        neutralizing[t] = neutralizing.get(t, 0.0) - v

    # residual (diagonal approximation)
    resid = 0.0
    resid_cov = 0.0
    resid_ok: set[int] = set()
    flagged = []
    hedge_added = []
    contrib = []
    for i, s in enumerate(stocks):
        lv = level_of.get(i)
        if not lv:
            continue
        sv, res = s["metrics"].get("stock_var"), s["metrics"].get(f"{lv}_res_er")
        if not (_finite(sv) and _finite(res)):
            continue
        if sv < 0:
            flagged.append({"ticker": s["ticker"], "reason": "negative stock_var"})
            continue
        if res > 1 + HEDGE_ADDED_EPS:
            hedge_added.append({"ticker": s["ticker"], "level": lv, "residual_share": round(float(res), 4)})
        v = s["value"] ** 2 * float(sv) * max(float(res), 0.0)
        resid += v
        resid_cov += abs(s["value"])
        resid_ok.add(i)
        contrib.append((s["ticker"], s["value"], v))

    out: dict[str, Any] = {
        "stock_beta_usd": stock_beta,
        "direct_etf_beta_usd": direct_beta,
        "total_beta_usd": stock_beta + direct_beta,
        "stock_hedge_trade_usd": hedge,
        "total_neutralizing_trade_usd": neutralizing,
        "names_by_level": counts,
        "excluded_from_lstar": excluded if basis == "lstar" else [],
        "residual_daily_variance": resid,
        "residual_flagged": flagged,
        "hedge_added_variance": hedge_added,
        "top_residual": sorted(contrib, key=lambda r: -r[2])[:15],
    }

    sys_var = None
    layers: dict[str, float] = {}
    sys_cov = total_cov = 0.0
    uncovered: set[str] = set()
    if S is not None and etfs:
        n = len(etfs)
        x_layer = {k: np.zeros(n) for k in ("market", "sector", "subsector", "direct_etf")}
        for i, s in enumerate(stocks):
            lv = level_of.get(i)
            legs = stock_legs(s["metrics"], s.get("sector_etf"), s.get("subsector_etf"), lv) if lv else None
            if not legs:
                continue
            missing = [e for e, _, _ in legs if e not in idx or not _finite(S[idx[e], idx[e]])]
            if missing:
                uncovered.update(missing)
                continue
            for etf, layer, hr in legs:
                x_layer[layer][idx[etf]] -= s["value"] * hr
            sys_cov += abs(s["value"])
            if i in resid_ok:
                total_cov += abs(s["value"])
        for t, v in direct_etfs.items():
            if t not in idx or not _finite(S[idx[t], idx[t]]):
                uncovered.add(t)
                continue
            x_layer["direct_etf"][idx[t]] += v
            sys_cov += abs(v)
            total_cov += abs(v)
        x = sum(x_layer.values())
        used = x != 0
        Su = np.where(np.isfinite(S), S, 0.0)
        sys_var = float(x[used] @ Su[np.ix_(used, used)] @ x[used]) if used.any() else 0.0
        for k, xl in x_layer.items():
            layers[k] = float(xl @ Su @ x)

    out["systematic_daily_variance"] = sys_var
    out["layer_contributions"] = layers
    total = (sys_var or 0.0) + resid
    for k, var in (("systematic", sys_var), ("residual", resid), ("total", total)):
        d = math.sqrt(max(var, 0.0)) if var is not None else None
        out[f"{k}_daily_vol_usd"] = d
        out[f"{k}_annual_vol_usd"] = d * math.sqrt(TRADING_DAYS) if d is not None else None
    out["coverage"] = {
        "beta": share(beta_cov + direct_beta_cov),
        "hedge": share(hedge_cov),
        "residual": share(resid_cov),
        "systematic": share(sys_cov),
        "total_risk": share(total_cov),
    }
    out["etfs_without_covariance"] = sorted(uncovered)
    return out


@dataclass
class ExposureHistoryPack:
    """The downloaded feed: ``names`` (long, one row per name per date) and ``cov``.

    ``names`` is month-end or daily depending on the request; ``cov`` is always
    month-end. Each date uses the latest covariance month-end on or before it.
    """

    names: pd.DataFrame
    cov: pd.DataFrame
    meta: dict = field(default_factory=dict)
    _cov_cache: dict = field(default_factory=dict, repr=False)

    @property
    def teos(self) -> list[str]:
        return sorted(self.names["teo"].unique().tolist()) if not self.names.empty else []

    @property
    def cov_teos(self) -> list[str]:
        return sorted(self.cov["teo"].unique().tolist()) if not self.cov.empty else []

    def covariance_at(self, teo: str) -> tuple[list[str], np.ndarray]:
        """ETF covariance from the latest month-end on or before ``teo`` (empty if none)."""
        eligible = [t for t in self.cov_teos if t <= teo]
        if not eligible:
            return [], np.zeros((0, 0))
        key = eligible[-1]
        if key not in self._cov_cache:
            c = self.cov[self.cov["teo"] == key]
            etfs = sorted(set(c["etf_i"]) | set(c["etf_j"]))
            k = {e: i for i, e in enumerate(etfs)}
            S = np.full((len(etfs), len(etfs)), np.nan)
            for i, j, v in zip(c["etf_i"], c["etf_j"], c["cov"]):
                S[k[i], k[j]] = S[k[j], k[i]] = v
            self._cov_cache[key] = (etfs, S)
        return self._cov_cache[key]

    def exposure(self, holdings: Any, *, basis: Basis = "lstar") -> pd.DataFrame:
        """Exposure at each month-end for the book held then.

        ``holdings``: either ``{ticker: signed_value}`` (one book at every month-end —
        look-back bias, warned) or ``{date: {ticker: signed_value}}`` / a DataFrame with
        columns ``date, ticker, value``. Each month-end uses the latest holdings dated on
        or before it; month-ends before the first holdings date are skipped.

        Returns one row per month-end; the full per-date detail is in ``.attrs["detail"]``.
        """
        dated = _normalize_holdings(holdings)
        if len(dated) == 1 and next(iter(dated)) is None:
            warnings.warn(
                "One fixed book applied to every past month-end: results describe how today's "
                "book would have looked and carry look-back bias. Pass dated holdings to avoid it.",
                stacklevel=2,
            )
        etf_universe = set(self.cov["etf_i"]) | set(self.cov["etf_j"])
        by_teo = {t: g.set_index("ticker") for t, g in self.names.groupby("teo", sort=True)}
        rows, detail = [], {}
        for teo in self.teos:
            book = _book_at(dated, teo)
            if book is None:
                continue
            panel = by_teo[teo]
            gross = float(sum(abs(v) for v in book.values()))
            stocks, direct, missing = [], {}, []
            for t, v in book.items():
                if t in panel.index:
                    r = panel.loc[t]
                    stocks.append({
                        "ticker": t, "value": float(v),
                        "sector_etf": r.get("sector_etf"), "subsector_etf": r.get("subsector_etf"),
                        "metrics": {k: (None if pd.isna(x) else float(x)) for k, x in r.items()
                                    if k not in ("teo", "symbol", "sector_etf", "subsector_etf")},
                    })
                elif t in etf_universe:
                    direct[t] = direct.get(t, 0.0) + float(v)
                else:
                    missing.append(t)
            etfs, S = self.covariance_at(teo)
            res = compute_signed_exposure(stocks, direct, gross, etfs, S, basis)
            res["not_in_feed"] = missing
            detail[teo] = res
            rows.append({
                "teo": teo, "gross_usd": gross,
                "total_beta_usd": res["total_beta_usd"],
                "systematic_daily_vol_usd": res["systematic_daily_vol_usd"],
                "residual_daily_vol_usd": res["residual_daily_vol_usd"],
                "total_daily_vol_usd": res["total_daily_vol_usd"],
                "total_annual_vol_usd": res["total_annual_vol_usd"],
                "coverage_total_risk": res["coverage"]["total_risk"],
                "names_excluded": len(res["excluded_from_lstar"]) + len(missing),
            })
        df = pd.DataFrame(rows)
        df.attrs["detail"] = detail
        df.attrs["basis"] = basis
        return df


def _normalize_holdings(h: Any) -> dict[str | None, dict[str, float]]:
    if isinstance(h, pd.DataFrame):
        out: dict[str | None, dict[str, float]] = {}
        for d, t, v in zip(h["date"], h["ticker"], h["value"]):
            key = pd.Timestamp(d).strftime("%Y-%m-%d")
            out.setdefault(key, {})
            out[key][str(t).upper()] = out[key].get(str(t).upper(), 0.0) + float(v)
        return out
    if isinstance(h, Mapping) and h and all(isinstance(v, Mapping) for v in h.values()):
        return {pd.Timestamp(d).strftime("%Y-%m-%d"): {str(t).upper(): float(v) for t, v in b.items()} for d, b in h.items()}
    if isinstance(h, Mapping):
        return {None: {str(t).upper(): float(v) for t, v in h.items()}}
    raise TypeError("holdings must be {ticker: value}, {date: {ticker: value}} or a DataFrame(date, ticker, value)")


def _book_at(dated: dict[str | None, dict[str, float]], teo: str) -> dict[str, float] | None:
    if None in dated:
        return dated[None]
    eligible = [d for d in dated if d is not None and d <= teo]
    return dated[max(eligible)] if eligible else None


def load_pack(names_bytes: bytes | list[bytes], cov_bytes: bytes, meta: dict | None = None) -> ExposureHistoryPack:
    """Build a pack from the Parquet payloads (daily names arrive as one file per year)."""
    parts = names_bytes if isinstance(names_bytes, list) else [names_bytes]
    frames = [pd.read_parquet(io.BytesIO(b)) for b in parts]
    names = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    return ExposureHistoryPack(names=names, cov=pd.read_parquet(io.BytesIO(cov_bytes)), meta=meta or {})
