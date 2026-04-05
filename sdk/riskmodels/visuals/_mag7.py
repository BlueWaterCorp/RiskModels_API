"""Shared MAG7 ticker resolution and cap-weight helpers.

Used by ``gallery.py``, ``generate_readme_assets.py``, and any future MAG7 recipes.
Centralizes the ticker list, GOOGL→GOOG normalization, and cap-weighted position logic.
"""

from __future__ import annotations

import warnings
from typing import Any, Literal

import pandas as pd

# Documented fallback when market_cap cannot be read for enough names (illustrative only).
MAG7_SNAPSHOT_DATE_DOC = "early 2026 (illustrative cap-share snapshot; used only as fallback)"

MAG7_CAP_WEIGHTS_FALLBACK_EARLY_2026: dict[str, float] = {
    "NVDA": 0.22,
    "AAPL": 0.18,
    "MSFT": 0.14,
    "GOOG": 0.12,
    "AMZN": 0.10,
    "META": 0.10,
    "TSLA": 0.14,
}

MAG7_FALLBACK_LIST: list[str] = ["AAPL", "MSFT", "GOOG", "AMZN", "META", "NVDA", "TSLA"]


def normalize_tickers(tickers: list[str]) -> list[str]:
    """Normalize a ticker list: strip whitespace, GOOGL→GOOG."""
    out: list[str] = []
    for t in tickers:
        u = str(t).strip()
        if u.upper() == "GOOGL":
            u = "GOOG"
        out.append(u)
    return out


def mag7_tickers(client: Any) -> list[str]:
    """Resolve MAG7 tickers from the API; fall back to ``MAG7_FALLBACK_LIST``."""
    df = client.search_tickers(mag7=True)
    if getattr(df, "empty", True):
        return list(MAG7_FALLBACK_LIST)
    col = "ticker" if "ticker" in df.columns else df.columns[0]
    out = [str(x).strip() for x in df[col].tolist() if x and str(x).strip()]
    return normalize_tickers(out if out else list(MAG7_FALLBACK_LIST))


def mag7_cap_weighted_positions(
    client: Any,
) -> tuple[list[dict[str, Any]], Literal["market_cap", "fallback_early_2026"]]:
    """Build MAG7 positions with weights ∝ ``market_cap`` when available; else documented fallback."""
    tickers = mag7_tickers(client)
    caps: list[tuple[str, float]] = []
    for sym in tickers:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            snap = client.get_metrics(sym, as_dataframe=True)
        row = snap.iloc[0]
        cap = row.get("market_cap")
        if cap is None or (isinstance(cap, float) and pd.isna(cap)):
            continue
        try:
            caps.append((str(sym).upper(), float(cap)))
        except (TypeError, ValueError):
            continue

    if len(caps) >= 3:
        wdf = pd.DataFrame(caps, columns=["ticker", "market_cap"])
        wdf["weight"] = wdf["market_cap"] / wdf["market_cap"].sum()
        return wdf[["ticker", "weight"]].to_dict("records"), "market_cap"

    positions: list[dict[str, Any]] = []
    for t in tickers:
        w = MAG7_CAP_WEIGHTS_FALLBACK_EARLY_2026.get(str(t).upper(), 0.0)
        if w > 0:
            positions.append({"ticker": t, "weight": w})
    s = sum(float(p["weight"]) for p in positions)
    if s <= 0:
        n = len(tickers)
        return [{"ticker": t, "weight": 1.0 / n} for t in tickers], "fallback_early_2026"
    return [{"ticker": p["ticker"], "weight": float(p["weight"]) / s} for p in positions], "fallback_early_2026"


__all__ = [
    "MAG7_CAP_WEIGHTS_FALLBACK_EARLY_2026",
    "MAG7_FALLBACK_LIST",
    "MAG7_SNAPSHOT_DATE_DOC",
    "mag7_cap_weighted_positions",
    "mag7_tickers",
    "normalize_tickers",
]
