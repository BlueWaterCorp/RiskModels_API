"""MAG7 horizontal L3 **explained risk** chart (variance fractions + ER annotations).

This matches the article / demo plot: each bar sums to 100% of variance; right-rail text uses
``annotation_mode=\"er_systematic\"`` (subsector ETF + systematic %). σ-scaling is **off** here.

Canonical tickers use **GOOG** (not GOOGL) to match the API universe and alias rules.
"""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any

from ..performance.stock import StockCurrent
from .l3_decomposition import plot_l3_horizontal
from .save import save_l3_decomposition_png

# Titles from ``RM_ORG/demos/article_visuals.py`` → ``fig_mag7_risk_table`` variant (1) variance shares.
MAG7_L3_ER_TITLE = 'MAG7: same "tech" label, different subsector DNA'
MAG7_L3_ER_SUBTITLE = "L3 orthogonal explained risk (latest snapshot)"

# Order matches common MAG7 lists; GOOG is the canonical Alphabet share class for the API.
MAG7_L3_ER_DEFAULT_TICKERS: list[str] = [
    "AAPL",
    "MSFT",
    "NVDA",
    "AMZN",
    "GOOG",
    "META",
    "TSLA",
]


def plot_mag7_l3_explained_risk(
    client: Any,
    *,
    tickers: list[str] | None = None,
    years: int = 1,
    title: str | None = None,
    subtitle: str | None = None,
    metadata: Mapping[str, Any] | None = None,
) -> Any:
    """Return a Plotly figure: MAG7 L3 explained-risk shares (not σ-scaled), ER annotation mode."""
    use = [str(t).strip().upper() for t in (tickers or MAG7_L3_ER_DEFAULT_TICKERS)]
    rows, lineage = StockCurrent(client)._metric_rows_for_tickers(use, years=years)
    if not rows:
        raise ValueError("No batch rows returned for MAG7 L3 explained-risk plot")
    return plot_l3_horizontal(
        rows,
        sigma_scaled=False,
        annotation_mode="er_systematic",
        title=title or MAG7_L3_ER_TITLE,
        subtitle=subtitle or MAG7_L3_ER_SUBTITLE,
        lineage=lineage,
        metadata=metadata,
    )


def save_mag7_l3_explained_risk_png(
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
    **kwargs: Any,
) -> Path:
    """Save the article-style MAG7 L3 explained-risk PNG (batch fetch + ``write_plotly_png``)."""
    use = [str(t).strip().upper() for t in (tickers or MAG7_L3_ER_DEFAULT_TICKERS)]
    return save_l3_decomposition_png(
        client,
        filename=filename,
        tickers=use,
        sigma_scaled=False,
        annotation_mode="er_systematic",
        title=title or MAG7_L3_ER_TITLE,
        subtitle=subtitle or MAG7_L3_ER_SUBTITLE,
        years=years,
        width=width,
        height=height,
        scale=scale,
        dpi=dpi,
        figsize=figsize,
        engine=engine,
        **kwargs,
    )


__all__ = [
    "MAG7_L3_ER_DEFAULT_TICKERS",
    "MAG7_L3_ER_SUBTITLE",
    "MAG7_L3_ER_TITLE",
    "plot_mag7_l3_explained_risk",
    "save_mag7_l3_explained_risk_png",
]
