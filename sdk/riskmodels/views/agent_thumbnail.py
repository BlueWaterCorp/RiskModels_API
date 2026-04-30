"""Compact L3 variance thumbnail for agents and UI embeds — pure transforms, no I/O."""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any, Literal

# Idiosyncratic variance vs an equal four-way sleeve split — same units as variance shares ([0,1]).
_SHARE_PARITY_BENCHMARK = 0.25
_SHARE_SIGNAL_THRESHOLD = 0.05  # ≈ five percentage points of total variance vs parity

ResidualSignal = Literal["positive", "negative", "neutral"]
DominantLayer = Literal["market", "sector", "subsector", "residual"]


_LAYER_ORDER: tuple[DominantLayer, ...] = ("market", "sector", "subsector", "residual")


def _get_path(data: Mapping[str, Any], path: str) -> Any:
    cur: Any = data
    for part in path.split("."):
        if not isinstance(cur, Mapping) or part not in cur:
            raise KeyError(path)
        cur = cur[part]
    return cur


def _has_path(data: Mapping[str, Any], path: str) -> bool:
    try:
        _get_path(data, path)
        return True
    except KeyError:
        return False


def _as_nonneg_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        x = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(x) or x < 0.0:
        return None
    return x


def _last_aligned_row_four(
    data: Mapping[str, Any],
    field_by_layer: Mapping[DominantLayer, tuple[str, ...]],
) -> dict[DominantLayer, float] | None:
    """Pick numeric keys (first alias per layer); use last index where all four are finite nonnegative."""
    sequences: dict[DominantLayer, list[Any]] = {}
    for layer in _LAYER_ORDER:
        aliases = field_by_layer.get(layer)
        if aliases is None:
            return None
        seq: list[Any] | None = None
        for alias in aliases:
            if alias not in data:
                continue
            candidate = data[alias]
            if isinstance(candidate, (str, bytes)) or not isinstance(candidate, (list, tuple)):
                seq = None
                break
            seq = list(candidate)
            break
        if seq is None:
            return None
        sequences[layer] = seq
    lengths = [len(sequences[L]) for L in _LAYER_ORDER]
    if not lengths or min(lengths) == 0:
        return None
    n = min(lengths)

    pick: dict[DominantLayer, float] | None = None
    for i in range(n - 1, -1, -1):
        floats: dict[DominantLayer, float] = {}
        skip = False
        for layer in _LAYER_ORDER:
            fv = _as_nonneg_float(sequences[layer][i])
            if fv is None:
                skip = True
                break
            floats[layer] = fv
        if skip:
            continue
        pick = floats
        break

    return pick


def _from_contr_variance(data: Mapping[str, Any]) -> dict[DominantLayer, float] | None:
    m = _as_nonneg_float(data.get("market_contr_variance"))
    s = _as_nonneg_float(data.get("sector_contr_variance"))
    su = _as_nonneg_float(data.get("subsector_contr_variance"))
    r = _as_nonneg_float(data.get("residual_contr_variance"))
    if None in (m, s, su, r):
        return None
    return {"market": m, "sector": s, "subsector": su, "residual": r}


def _from_exposure_er(data: Mapping[str, Any]) -> dict[DominantLayer, float] | None:
    if not _has_path(data, "exposure.market.er"):
        return None
    out: dict[DominantLayer, float] = {}
    for layer in _LAYER_ORDER:
        fv = _as_nonneg_float(_get_path(data, f"exposure.{layer}.er"))
        if fv is None:
            return None
        out[layer] = fv
    return out


_VAR_DECOMP_SCALAR_PATHS: tuple[tuple[str, ...], ...] = (
    (
        "portfolio_risk_index.variance_decomposition.market",
        "portfolio_risk_index.variance_decomposition.sector",
        "portfolio_risk_index.variance_decomposition.subsector",
        "portfolio_risk_index.variance_decomposition.residual",
    ),
    (
        "snapshot.variance_decomposition.market",
        "snapshot.variance_decomposition.sector",
        "snapshot.variance_decomposition.subsector",
        "snapshot.variance_decomposition.residual",
    ),
)


def _from_variance_decomposition_scalars(data: Mapping[str, Any]) -> dict[DominantLayer, float] | None:
    for paths in _VAR_DECOMP_SCALAR_PATHS:
        if not all(_has_path(data, p) for p in paths):
            continue
        out: dict[DominantLayer, float] = {}
        for layer, path in zip(_LAYER_ORDER, paths, strict=True):
            fv = _as_nonneg_float(_get_path(data, path))
            if fv is None:
                out = {}
                break
            out[layer] = fv
        if len(out) == 4:
            return out
    return None


_L3_ER_ALIASES: dict[DominantLayer, tuple[str, ...]] = {
    "market": ("l3_market_er", "l3_mkt_er"),
    "sector": ("l3_sector_er", "l3_sec_er"),
    "subsector": ("l3_subsector_er", "l3_sub_er"),
    "residual": ("l3_residual_er", "l3_res_er"),
}


def _from_l3_json_timeseries(data: Mapping[str, Any]) -> dict[DominantLayer, float] | None:
    picked = _last_aligned_row_four(data, _L3_ER_ALIASES)
    return picked


def get_layer_shares(data: Mapping[str, Any]) -> dict[str, float]:
    """Return nonnegative market/sector/subsector/residual shares summing to 1 when possible."""

    typed: dict[DominantLayer, float] | None = (
        _from_contr_variance(data)
        or _from_exposure_er(data)
        or _from_variance_decomposition_scalars(data)
        or _from_l3_json_timeseries(data)
    )
    if typed is None:
        raise ValueError(
            "Cannot derive L3 variance shares: expected *_contr_variance, exposure.*.er, "
            "snapshot/portfolio variance_decomposition scalars, or parallel l3_*_er arrays."
        )

    total = sum(typed[L] for L in _LAYER_ORDER)
    if total <= 0.0:
        raise ValueError("L3 variance shares sum to zero or invalid.")
    normed: dict[str, float] = {L: typed[L] / total for L in _LAYER_ORDER}
    return normed


def classify_residual(residual_share: float) -> ResidualSignal:
    """Residual idiosyncratic signal vs symmetric four-layer split (parity 0.25, band ±threshold)."""

    delta = float(residual_share) - _SHARE_PARITY_BENCHMARK
    if delta > _SHARE_SIGNAL_THRESHOLD:
        return "positive"
    if delta < -_SHARE_SIGNAL_THRESHOLD:
        return "negative"
    return "neutral"


def get_dominant_layer(shares: Mapping[str, float]) -> DominantLayer:
    """Dominant sleeve by largest variance share."""

    dom: DominantLayer = "market"
    best = float(shares.get("market") or -1.0)
    # shares always include all four layers after normalization
    for layer in ("sector", "subsector", "residual"):
        v = float(shares[layer])
        if v > best:
            best = v
            dom = layer
    return dom


def _sector_etf(data: Mapping[str, Any]) -> str | None:
    if not isinstance(data, Mapping):
        return None
    expo = data.get("exposure")
    if isinstance(expo, Mapping):
        sec = expo.get("sector")
        if isinstance(sec, Mapping):
            etf = sec.get("hedge_etf")
            if isinstance(etf, str) and etf.strip():
                return etf.strip().upper()
    return None


def _subsector_etf(data: Mapping[str, Any]) -> str | None:
    expo = data.get("exposure")
    if isinstance(expo, Mapping):
        sub = expo.get("subsector")
        if isinstance(sub, Mapping):
            etf = sub.get("hedge_etf")
            if isinstance(etf, str) and etf.strip():
                return etf.strip().upper()
    return None


def generate_hedge_hint(
    dominant_layer: DominantLayer,
    residual_signal: ResidualSignal,
    data: Mapping[str, Any],
) -> str:
    """One-line actionable hedge cue; residual sleeve is explicit about non-ETF hedge."""

    _ = residual_signal  # reserved for paired summary + hint composition

    market_etf_raw = data.get("market_factor_etf")
    market_etf = (
        market_etf_raw.strip().upper()
        if isinstance(market_etf_raw, str) and market_etf_raw.strip()
        else None
    )
    if market_etf is None and isinstance(data.get("exposure"), Mapping):
        m = data["exposure"]
        if isinstance(m.get("market"), Mapping):
            hedge = m["market"].get("hedge_etf")
            if isinstance(hedge, str) and hedge.strip():
                market_etf = hedge.strip().upper()
    market_etf = market_etf or "SPY"

    if dominant_layer == "residual":
        return "Residual risk dominates — not hedgeable."

    if dominant_layer == "market":
        return f"Hedge market exposure ({market_etf})."

    if dominant_layer == "sector":
        etf = _sector_etf(data)
        return f"Hedge sector exposure ({etf})." if etf else "Reduce sector exposure."

    # subsector
    etf = _subsector_etf(data)
    if etf:
        return f"Hedge subsector exposure ({etf})."
    return "Hedge subsector concentration."


def generate_summary(shares: Mapping[str, float], dominant_layer: DominantLayer, residual_signal: ResidualSignal) -> str:
    """Single sentence summary — terse, deterministic."""

    if dominant_layer == "residual":
        return "Stock-specific performance dominated returns."

    if dominant_layer == "market":
        if residual_signal == "negative":
            return "Residual drag offset strong market gains."
        if residual_signal == "positive":
            return "Idiosyncratic variance rose beside market-heavy risk."
        return "Performance driven mostly by market exposure."

    if dominant_layer == "sector":
        if residual_signal == "neutral":
            return "Sector sleeve drove most of the variance."
        if residual_signal == "negative":
            return "Residual drag offset sector sleeves."
        return "Stock-specific variance rose beside sector sleeves."

    # subsector
    if residual_signal == "neutral":
        return "Subsector sleeve drove most of the variance."
    if residual_signal == "negative":
        return "Residual drag offset subsector sleeves."
    return "Stock-specific variance rose beside subsector sleeves."


def agent_thumbnail(data: dict[str, Any]) -> dict[str, Any]:
    """
    Build a minimal structured thumbnail from a `/decompose` or `/l3-decomposition`-style payload.

    No API calls — transforms only. Layers are nonnegative variance fractions; ``residual_signal``
    contrasts idiosyncratic share versus a symmetric four-way sleeve split.

    Output shape::
        summary, residual_signal, dominant_layer, hedge_hint, key_numbers: { residual_share, market_share }
    """
    shares_typed = get_layer_shares(data)
    rs = classify_residual(shares_typed["residual"])
    dom = get_dominant_layer(shares_typed)
    hint = generate_hedge_hint(dom, rs, data)
    summary = generate_summary(shares_typed, dom, rs)

    return {
        "summary": summary,
        "residual_signal": rs,
        "dominant_layer": dom,
        "hedge_hint": hint,
        "key_numbers": {
            "residual_share": float(shares_typed["residual"]),
            "market_share": float(shares_typed["market"]),
        },
    }


__all__ = [
    "agent_thumbnail",
    "classify_residual",
    "generate_hedge_hint",
    "generate_summary",
    "get_dominant_layer",
    "get_layer_shares",
]
