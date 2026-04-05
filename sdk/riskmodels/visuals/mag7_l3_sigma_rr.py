"""MAG7 horizontal L3 **σ-scaled RR + HR** chart (annualized vol × risk ratios).

This matches the article / demo plot where each bar's total length is the stock's annualized σ,
segmented by L3 market / sector / subsector risk ratios and the residual hedging ratio share.
Right-rail text uses ``annotation_mode="rr_hr"`` (subsector ETF + systematic % + SPY HR).

Canonical tickers use **GOOG** (not GOOGL) to match the API universe and alias rules.
"""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any

from ..performance.stock import StockCurrent
from .l3_decomposition import plot_l3_horizontal
from .save import save_l3_decomposition_png

# Titles from ``RM_ORG/demos/article_visuals.py`` → ``fig_mag7_risk_table`` variant (2) σ-scaled.
MAG7_L3_SIGMA_RR_TITLE = 'MAG7: same "tech" label, different subsector DNA (σ-scaled, RR + HR)'
MAG7_L3_SIGMA_RR_SUBTITLE = (
    "L3 risk ratios (RR) + residual (HR) — bar width ∝ σ; "
    "RR from l3_*_er unless API sends l3_*.rr"
)

# Order matches common MAG7 lists; GOOG is the canonical Alphabet share class for the API.
MAG7_L3_SIGMA_RR_DEFAULT_TICKERS: list[str] = [
    "AAPL",
    "MSFT",
    "NVDA",
    "AMZN",
    "GOOG",
    "META",
    "TSLA",
]


def plot_mag7_l3_sigma_rr(
    client: Any,
    *,
    tickers: list[str] | None = None,
    years: int = 1,
    title: str | None = None,
    subtitle: str | None = None,
    metadata: Mapping[str, Any] | None = None,
    theme: str = "light",
) -> Any:
    """Return a Plotly figure: MAG7 L3 σ-scaled risk ratios + hedging ratio residual."""
    use = [str(t).strip().upper() for t in (tickers or MAG7_L3_SIGMA_RR_DEFAULT_TICKERS)]
    rows, lineage = StockCurrent(client)._metric_rows_for_tickers(
        use, years=years, fill_sigma_from_returns=True
    )
    if not rows:
        raise ValueError("No batch rows returned for MAG7 L3 σ-scaled RR+HR plot")
    return plot_l3_horizontal(
        rows,
        sigma_scaled=True,
        annotation_mode="rr_hr",
        title=title or MAG7_L3_SIGMA_RR_TITLE,
        subtitle=subtitle or MAG7_L3_SIGMA_RR_SUBTITLE,
        lineage=lineage,
        metadata=metadata,
        theme=theme,
    )


def save_mag7_l3_sigma_rr_png(
    client: Any,
    *,
    filename: str | Path,
    tickers: list[str] | None = None,
    title: str | None = None,
    subtitle: str | None = None,
    years: int = 1,
    width: int = 1600,
    height: int = 1000,
    scale: int | float = 3,
    dpi: int | None = None,
    figsize: tuple[float, float] | None = None,
    engine: str = "kaleido",
    theme: str = "light",
    **kwargs: Any,
) -> Path:
    """Save the article-style MAG7 L3 σ-scaled RR+HR PNG (batch fetch + ``write_plotly_png``)."""
    use = [str(t).strip().upper() for t in (tickers or MAG7_L3_SIGMA_RR_DEFAULT_TICKERS)]
    return save_l3_decomposition_png(
        client,
        filename=filename,
        tickers=use,
        sigma_scaled=True,
        annotation_mode="rr_hr",
        title=title or MAG7_L3_SIGMA_RR_TITLE,
        subtitle=subtitle or MAG7_L3_SIGMA_RR_SUBTITLE,
        years=years,
        width=width,
        height=height,
        scale=scale,
        dpi=dpi,
        figsize=figsize,
        engine=engine,
        theme=theme,
        **kwargs,
    )


__all__ = [
    "MAG7_L3_SIGMA_RR_DEFAULT_TICKERS",
    "MAG7_L3_SIGMA_RR_SUBTITLE",
    "MAG7_L3_SIGMA_RR_TITLE",
    "plot_mag7_l3_sigma_rr",
    "save_mag7_l3_sigma_rr_png",
]
