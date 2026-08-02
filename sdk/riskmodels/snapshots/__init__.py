"""Public stock snapshot surface — canonical contract + reference renderer.

Architecture
------------
Pure Plotly + Matplotlib primitives. The canonical contract
(:class:`CanonicalStockSnapshot`) is the single semantic object backing all
public stock snapshots; the reference renderer paints it onto a 1-page,
landscape PDF/PNG.

Institutional renderers (R1 Risk Profile, P1 Stock Performance,
Stock Deep Dive, S1/S2 legacy) and curated content live in BWMACRO. The
``rm_api_public`` GCS bucket pipeline never imports ``bwmacro.*`` — it must
stay self-sufficient on this canonical pipeline.

The terminology is deliberate: this module is the *reference renderer* —
the deterministic baseline that anyone with the canonical contract can run.
The BWMACRO renderers are *institutional renderers* — enriched compositions
with Judgment narrative, peer presentation, and hedge-construction visuals.
Both consume the same canonical object.

Data layer
----------
    fetch_stock_context(ticker, client)  → StockContext
    build_p1_data_from_stock_context(ctx) → P1Data
    from_components(p1, peer_comparison=…) → CanonicalStockSnapshot
    render_canonical_to_pdf(snap, path)   → Path
"""

# Design system (Matplotlib)
from ._theme import THEME, Theme, Palette, Typography, Layout, Strokes

# Design system (Plotly)
from ._plotly_theme import PLOTLY_THEME, PlotlyTheme, apply_theme

# Layout engine (Matplotlib)
from ._page import SnapshotPage

# Chart primitives — Matplotlib
from ._charts import (
    chart_hbar,
    chart_grouped_vbar,
    chart_stacked_area,
    chart_multi_line,
    chart_waterfall,
    chart_heatmap,
    chart_table,
    chart_histogram,
    chart_bullet,
)

# Chart primitives — Plotly
from ._plotly_charts import (
    chart_hbar as px_hbar,
    chart_grouped_vbar as px_grouped_vbar,
    chart_stacked_area as px_stacked_area,
    chart_multi_line as px_multi_line,
    chart_waterfall as px_waterfall,
    chart_heatmap as px_heatmap,
    chart_table as px_table,
    chart_histogram as px_histogram,
    chart_bullet as px_bullet,
)

# Shared data layer
from ._data import (
    StockContext,
    fetch_stock_context,
    trailing_returns,
    cumulative_returns,
    rolling_sharpe,
    max_drawdown_series,
    relative_returns,
)

# Stock data layer (P1Data + builders)
from ._stock_data import (
    P1Data,
    build_p1_data_from_stock_context,
    cumulative_benchmark_line_labels,
    fetch_macro_correlations_resilient,
    get_data_for_p1,
)

# Fund data layer (F1 — zarr-backed; private render-svc may enrich holdings)
from ._fund_data import (
    FundAsOfUnavailableError,
    FundData,
    FundHolding,
    ZARR_FUNDS_GCS_PREFIX,
    from_fixture_row,
    load_fund_from_fixture,
    get_data_for_f1,
    _funds_latest_path,
)

# JSON-first pipeline
from ._json_io import dump_json, load_json

# Canonical contract — single semantic object backing all stock snapshots.
from .canonical import (
    CANONICAL_ONTOLOGY_VERSION,
    CANONICAL_SCHEMA_VERSION,
    CanonicalStockSnapshot,
    Identity,
    CoreMetrics,
    AttributionPoint,
    PerformanceAttribution,
    DecompositionPoint,
    RiskDecomposition,
    PeerRow,
    PeerContext,
    HedgeBasis,
    MacroBasis,
    AomProvenance,
    OBSERVATION_MODES,
    TemporalContext,
    from_components,
    from_dd_data,
)
from .canonical_fund import (
    CANONICAL_FUND_SCHEMA_VERSION,
    CanonicalFundSnapshot,
    FilerMetadata,
    FundIdentity,
    FundPortfolio,
    HoldingRow,
    from_fund_components,
)
from .reference_renderer import (
    render_canonical_to_pdf,
    render_canonical_to_png,
    render_canonical_to_png_bytes,
)
from .reference_renderer_fund import (
    render_canonical_fund_to_pdf,
    render_canonical_fund_to_png,
    render_canonical_fund_to_png_bytes,
)

__all__ = [
    # Design system — Matplotlib
    "THEME", "Theme", "Palette", "Typography", "Layout", "Strokes",
    # Design system — Plotly
    "PLOTLY_THEME", "PlotlyTheme", "apply_theme",
    # Layout engine — Matplotlib
    "SnapshotPage",
    # Chart primitives — Matplotlib
    "chart_hbar",
    "chart_grouped_vbar",
    "chart_stacked_area",
    "chart_multi_line",
    "chart_waterfall",
    "chart_heatmap",
    "chart_table",
    "chart_histogram",
    "chart_bullet",
    # Chart primitives — Plotly
    "px_hbar",
    "px_grouped_vbar",
    "px_stacked_area",
    "px_multi_line",
    "px_waterfall",
    "px_heatmap",
    "px_table",
    "px_histogram",
    "px_bullet",
    # Shared data layer
    "StockContext",
    "fetch_stock_context",
    "trailing_returns",
    "cumulative_returns",
    "rolling_sharpe",
    "max_drawdown_series",
    "relative_returns",
    # Stock data layer
    "P1Data",
    "build_p1_data_from_stock_context",
    "cumulative_benchmark_line_labels",
    "fetch_macro_correlations_resilient",
    "get_data_for_p1",
    # Fund data layer (F1)
    "FundAsOfUnavailableError",
    "FundData",
    "FundHolding",
    "from_fixture_row",
    "load_fund_from_fixture",
    "get_data_for_f1",
    "ZARR_FUNDS_GCS_PREFIX",
    "_funds_latest_path",
    # JSON-first pipeline
    "dump_json",
    "load_json",
    # Canonical contract + reference renderer
    "CANONICAL_ONTOLOGY_VERSION",
    "CANONICAL_SCHEMA_VERSION",
    "CanonicalStockSnapshot",
    "Identity",
    "CoreMetrics",
    "AttributionPoint",
    "PerformanceAttribution",
    "DecompositionPoint",
    "RiskDecomposition",
    "PeerRow",
    "PeerContext",
    "HedgeBasis",
    "MacroBasis",
    "AomProvenance",
    "OBSERVATION_MODES",
    "TemporalContext",
    "from_components",
    "from_dd_data",
    "CANONICAL_FUND_SCHEMA_VERSION",
    "CanonicalFundSnapshot",
    "FundIdentity",
    "FilerMetadata",
    "HoldingRow",
    "FundPortfolio",
    "from_fund_components",
    "render_canonical_to_pdf",
    "render_canonical_to_png",
    "render_canonical_to_png_bytes",
    "render_canonical_fund_to_pdf",
    "render_canonical_fund_to_png",
    "render_canonical_fund_to_png_bytes",
]
