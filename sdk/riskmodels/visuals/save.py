"""High-level helpers: save Plotly figures as publication-quality PNGs (Kaleido)."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from ..portfolio_math import PositionsInput
from ..performance.stock import StockCurrent
from .cascade import plot_attribution_cascade, plot_risk_cascade
from .l3_decomposition import plot_l3_horizontal
from .utils import build_title, footnote_from_lineage

SortKey = Literal["weight", "risk_contribution"]

_L3_PLOT_KEYS = frozenset(
    {"annotation_mode", "style_preset", "metadata", "annotation_formatter", "tuple_from_row", "theme"},
)


def _resolve_export_scale(*, scale: int | float, dpi: int | None) -> float:
    if dpi is not None:
        return max(float(dpi) / 96.0, 0.25)
    return float(scale)


def _resolve_fig_pixels(
    width: int,
    height: int,
    figsize: tuple[float, float] | None,
) -> tuple[int, int]:
    if figsize is None:
        return width, height
    w, h = figsize
    if w <= 0 or h <= 0:
        raise ValueError("figsize must be positive (width_px, height_px)")
    return int(round(w)), int(round(h))


def write_plotly_png(
    fig: Any,
    path: str | Path,
    *,
    width: int = 1200,
    height: int = 800,
    scale: int | float = 3,
    dpi: int | None = None,
    figsize: tuple[float, float] | None = None,
    engine: str = "kaleido",
) -> Path:
    """Export a Plotly figure to PNG using Kaleido (``pip install riskmodels-py[viz]``).

    ``figsize``, when set, overrides ``width`` / ``height`` with pixel dimensions ``(w, h)``.
    ``dpi`` maps to Kaleido ``scale`` as ``dpi / 96`` (96 dpi baseline).
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    pw, ph = _resolve_fig_pixels(width, height, figsize)
    sc = _resolve_export_scale(scale=scale, dpi=dpi)
    fig.update_layout(width=pw, height=ph, autosize=False)
    try:
        fig.write_image(str(path), width=pw, height=ph, scale=sc, format="png", engine=engine)
    except Exception as e:
        raise ImportError(
            "PNG export requires Kaleido. Install with: pip install riskmodels-py[viz] "
            "(or: pip install kaleido)"
        ) from e
    return path


def save_l3_decomposition_png(
    client: Any,
    *,
    filename: str | Path,
    ticker: str | None = None,
    tickers: list[str] | None = None,
    sigma_scaled: bool = True,
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
    """Fetch batch metrics for one or more tickers and save an L3 horizontal decomposition PNG."""
    sc = StockCurrent(client)
    if ticker and tickers:
        tickers = None
    if ticker:
        tickers_use = [ticker]
    elif tickers:
        tickers_use = list(tickers)
    else:
        raise ValueError("Provide ticker= or tickers=")

    rows, lineage = sc._metric_rows_for_tickers(
        [str(t).strip().upper() for t in tickers_use],
        years=years,
        fill_sigma_from_returns=sigma_scaled,
    )
    if not rows:
        raise ValueError("No metric rows returned for the requested ticker(s)")

    plot_kw = {k: v for k, v in kwargs.items() if k in _L3_PLOT_KEYS}
    fig = plot_l3_horizontal(
        rows,
        sigma_scaled=sigma_scaled,
        lineage=lineage,
        title=title,
        subtitle=subtitle,
        **plot_kw,
    )
    return write_plotly_png(
        fig,
        filename,
        width=width,
        height=height,
        scale=scale,
        dpi=dpi,
        figsize=figsize,
        engine=engine,
    )


def save_portfolio_risk_cascade_png(
    client: Any,
    *,
    positions: PositionsInput,
    filename: str | Path,
    sort_by: SortKey = "weight",
    include_systematic_labels: bool = True,
    benchmark: dict[str, float] | None = None,
    title: str | None = None,
    subtitle: str | None = None,
    years: int = 1,
    width: int = 1600,
    height: int = 1000,
    scale: int | float = 3,
    dpi: int | None = None,
    figsize: tuple[float, float] | None = None,
    validate: Any = None,
    er_tolerance: float | None = None,
    metrics: tuple[str, ...] | list[str] | None = None,
    metadata: dict[str, Any] | None = None,
    engine: str = "kaleido",
) -> Path:
    """Portfolio L3 explained-risk cascade (variable-width bars) as PNG."""
    pa = client.analyze_portfolio(
        positions,
        include_returns_panel=False,
        years=years,
        validate=validate,
        er_tolerance=er_tolerance,
        metrics=metrics,
    )
    meta = dict(metadata or {})
    if pa.lineage:
        meta.setdefault("model_version", pa.lineage.model_version)
        meta.setdefault("data_as_of", pa.lineage.data_as_of)

    fig = plot_risk_cascade(
        pa.per_ticker,
        pa.weights,
        sort_by=sort_by,
        include_systematic_labels=include_systematic_labels,
        benchmark=benchmark,
        metadata=meta,
        lineage=pa.lineage,
    )
    foot = footnote_from_lineage(pa.lineage)
    if title is not None or subtitle is not None:
        head = title if title is not None else "Portfolio L3 risk cascade"
        txt = build_title(head, metadata=meta, subtitle=subtitle)
        fig.update_layout(title=dict(text=txt + (f"<br><sub>{foot}</sub>" if foot else "")))
    return write_plotly_png(
        fig,
        filename,
        width=width,
        height=height,
        scale=scale,
        dpi=dpi,
        figsize=figsize,
        engine=engine,
    )


def save_portfolio_attribution_cascade_png(
    client: Any,
    *,
    positions: PositionsInput,
    filename: str | Path,
    sort_by: SortKey = "weight",
    title: str | None = None,
    subtitle: str | None = None,
    years: int = 1,
    width: int = 1600,
    height: int = 1000,
    scale: int | float = 3,
    dpi: int | None = None,
    figsize: tuple[float, float] | None = None,
    validate: Any = None,
    er_tolerance: float | None = None,
    metrics: tuple[str, ...] | list[str] | None = None,
    metadata: dict[str, Any] | None = None,
    engine: str = "kaleido",
) -> Path:
    """Attribution proxy cascade (needs returns panel). Saves as PNG."""
    if metrics is None:
        mlist = ["full_metrics", "hedge_ratios", "returns"]
    else:
        mlist = list(metrics)
        if "returns" not in mlist:
            mlist = [*mlist, "returns"]

    pa = client.analyze_portfolio(
        positions,
        include_returns_panel=True,
        years=years,
        validate=validate,
        er_tolerance=er_tolerance,
        metrics=mlist,
    )
    rl = pa.returns_long
    if rl is None or rl.empty:
        raise ValueError(
            "No returns panel in batch response; cannot build attribution cascade. "
            "Ensure metrics include 'returns' and tickers resolve successfully."
        )

    meta = dict(metadata or {})
    if pa.lineage:
        meta.setdefault("model_version", pa.lineage.model_version)
        meta.setdefault("data_as_of", pa.lineage.data_as_of)

    fig = plot_attribution_cascade(
        rl,
        pa.weights,
        pa.per_ticker,
        sort_by=sort_by,
        metadata=meta,
        lineage=pa.lineage,
    )
    foot = footnote_from_lineage(pa.lineage)
    if title is not None or subtitle is not None:
        head = title if title is not None else "Portfolio attribution proxy (v1)"
        txt = build_title(head, metadata=meta, subtitle=subtitle)
        proxy_note = "Proxy: weighted realized return × snapshot ER shares (not Brinson)."
        fig.update_layout(
            title=dict(
                text=txt
                + f"<br><sub>{proxy_note}</sub>"
                + (f"<br><sub>{foot}</sub>" if foot else "")
            ),
        )
    return write_plotly_png(
        fig,
        filename,
        width=width,
        height=height,
        scale=scale,
        dpi=dpi,
        figsize=figsize,
        engine=engine,
    )


__all__ = [
    "write_plotly_png",
    "save_l3_decomposition_png",
    "save_portfolio_risk_cascade_png",
    "save_portfolio_attribution_cascade_png",
]
