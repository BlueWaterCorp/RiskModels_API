"""Ready-made gallery recipes: NVDA L3 + MAG7 cap-weighted portfolio cascades.

Weights from ``market_cap`` use live ``get_metrics`` data when available; otherwise a documented
early-2026 illustrative cap-share snapshot is used (not from a single exchange close).
"""

from __future__ import annotations

import warnings
from pathlib import Path
from typing import Any, Literal

import pandas as pd

from .mag7_l3_er import save_mag7_l3_explained_risk_png
from .save import (
    save_l3_decomposition_png,
    save_portfolio_attribution_cascade_png,
    save_portfolio_risk_cascade_png,
)

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

_MAG7_FALLBACK_LIST = ["AAPL", "MSFT", "GOOG", "AMZN", "META", "NVDA", "TSLA"]


def _normalize_tickers(tickers: list[str]) -> list[str]:
    out: list[str] = []
    for t in tickers:
        u = str(t).strip()
        if u.upper() == "GOOGL":
            u = "GOOG"
        out.append(u)
    return out


def _mag7_tickers(client: Any) -> list[str]:
    df = client.search_tickers(mag7=True)
    if getattr(df, "empty", True):
        return list(_MAG7_FALLBACK_LIST)
    col = "ticker" if "ticker" in df.columns else df.columns[0]
    out = [str(x).strip() for x in df[col].tolist() if x and str(x).strip()]
    return _normalize_tickers(out if out else list(_MAG7_FALLBACK_LIST))


def mag7_cap_weighted_positions(
    client: Any,
) -> tuple[list[dict[str, Any]], Literal["market_cap", "fallback_early_2026"]]:
    """Build MAG7 positions with weights ∝ ``market_cap`` when available; else documented fallback."""
    tickers = _mag7_tickers(client)
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


def run_gallery_mag7_l3_er(
    client: Any,
    output_dir: str | Path = ".",
    *,
    filename: str = "mag7_l3_explained_risk.png",
    title: str | None = None,
    subtitle: str | None = None,
    **kwargs: Any,
) -> Path:
    """Article-style MAG7 L3 explained-risk bars (variance fractions; ``er_systematic`` annotations)."""
    out = Path(output_dir)
    return save_mag7_l3_explained_risk_png(
        client,
        filename=out / filename,
        title=title,
        subtitle=subtitle,
        **kwargs,
    )


def run_gallery_nvda_l3(
    client: Any,
    output_dir: str | Path = ".",
    *,
    filename: str = "nvda_l3_risk.png",
    title: str | None = None,
    subtitle: str | None = None,
    **kwargs: Any,
) -> Path:
    """Save σ-scaled L3 decomposition for NVDA (live batch metrics)."""
    out = Path(output_dir)
    return save_l3_decomposition_png(
        client,
        filename=out / filename,
        ticker="NVDA",
        title=title or "NVDA — L3 risk decomposition",
        subtitle=subtitle,
        **kwargs,
    )


def run_gallery_mag7_risk_cascade(
    client: Any,
    output_dir: str | Path = ".",
    *,
    filename: str = "mag7_risk_cascade.png",
    title: str | None = None,
    subtitle: str | None = None,
    **kwargs: Any,
) -> tuple[Path, Literal["market_cap", "fallback_early_2026"]]:
    positions, src = mag7_cap_weighted_positions(client)
    if subtitle is None:
        subtitle = (
            f"MAG7 cap-weighted · weights: {src}"
            + (f" · fallback doc: {MAG7_SNAPSHOT_DATE_DOC}" if src == "fallback_early_2026" else "")
        )
    out = Path(output_dir)
    path = save_portfolio_risk_cascade_png(
        client,
        positions=positions,
        filename=out / filename,
        title=title or "MAG7 — L3 risk cascade",
        subtitle=subtitle,
        **kwargs,
    )
    return path, src


def run_gallery_mag7_attribution_cascade(
    client: Any,
    output_dir: str | Path = ".",
    *,
    filename: str = "mag7_attribution_cascade.png",
    title: str | None = None,
    subtitle: str | None = None,
    **kwargs: Any,
) -> tuple[Path, Literal["market_cap", "fallback_early_2026"]]:
    positions, src = mag7_cap_weighted_positions(client)
    if subtitle is None:
        subtitle = (
            f"MAG7 cap-weighted · weights: {src}"
            + (f" · fallback doc: {MAG7_SNAPSHOT_DATE_DOC}" if src == "fallback_early_2026" else "")
        )
    out = Path(output_dir)
    path = save_portfolio_attribution_cascade_png(
        client,
        positions=positions,
        filename=out / filename,
        title=title or "MAG7 — attribution proxy cascade",
        subtitle=subtitle,
        **kwargs,
    )
    return path, src


_GALLERY_COMMON_KW = frozenset(
    {"width", "height", "scale", "dpi", "figsize", "engine", "years", "validate", "er_tolerance"},
)


def run_gallery_all(
    client: Any,
    output_dir: str | Path = ".",
    **kwargs: Any,
) -> list[Path]:
    """Write NVDA L3 + MAG7 L3 ER + MAG7 risk + MAG7 attribution PNGs into ``output_dir``.

    Only export-related keys (``width``, ``height``, ``scale``, ``dpi``, ``figsize``, ``engine``,
    ``years``, ``validate``, ``er_tolerance``) are forwarded to each chart; pass the ``run_gallery_*``
    functions individually for custom titles.
    """
    common = {k: v for k, v in kwargs.items() if k in _GALLERY_COMMON_KW}
    out: list[Path] = []
    out.append(run_gallery_nvda_l3(client, output_dir, **common))
    out.append(run_gallery_mag7_l3_er(client, output_dir, **common))
    p1, _ = run_gallery_mag7_risk_cascade(client, output_dir, **common)
    out.append(p1)
    p2, _ = run_gallery_mag7_attribution_cascade(client, output_dir, **common)
    out.append(p2)
    return out


__all__ = [
    "MAG7_CAP_WEIGHTS_FALLBACK_EARLY_2026",
    "MAG7_SNAPSHOT_DATE_DOC",
    "mag7_cap_weighted_positions",
    "run_gallery_all",
    "run_gallery_mag7_attribution_cascade",
    "run_gallery_mag7_l3_er",
    "run_gallery_mag7_risk_cascade",
    "run_gallery_nvda_l3",
]
