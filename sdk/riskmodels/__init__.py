"""RiskModels API — Python SDK (decompose US equities: variance shares, ETF hedge ratios, ERM3).

Contributor recognition is shipped in-package: see ``SDK_CONTRIBUTORS`` and
``RiskModelsClient.discover()`` (Markdown / JSON includes a ``contributors`` list).
"""

from .client import RiskModelsClient
from .contributors import SDK_CONTRIBUTORS, SDKContributorDict
from .enums import DataKind, DataKindLiteral, OutputKind, OutputLiteral, TimeAxis, TimeLiteral
from .env import load_repo_dotenv
from .exceptions import (
    APIError,
    AuthError,
    RiskModelsValidationError,
    RiskModelsValidationIssue,
    ValidationWarning,
)
from .insights import ChatInsights, InsightsNamespace
from .legends import (
    COMBINED_ERM3_MACRO_LEGEND,
    RANKINGS_SMALL_COHORT_THRESHOLD,
    SHORT_ERM3_LEGEND,
    SHORT_MACRO_CORR_LEGEND,
    SHORT_RANKINGS_LEGEND,
)
from .lineage import RiskLineage
from .llm import to_llm_context
from .metadata_attach import (
    attach_sdk_metadata,
    build_semantic_cheatsheet_md,
    ensure_dataframe_legend,
)
from .metrics_snapshot import format_metrics_snapshot
from .peer_group import PeerComparison, PeerGroupProxy
from .performance.base import PerformanceResult
from .portfolio_math import PortfolioAnalysis, PositionsInput, positions_to_weights
from .snapshots import (
    S1Data,
    S2Data,
    StockContext,
    cumulative_returns,
    fetch_stock_context,
    get_data_for_s1,
    get_data_for_s2,
    max_drawdown_series,
    relative_returns,
    render_s1_to_pdf,
    render_s2_to_pdf,
    rolling_sharpe,
    trailing_returns,
)
from .visual_refinement import (
    MatPlotAgent,
    RefinementResult,
    generate_refined_plot,
    save_macro_heatmap,
    save_macro_sensitivity_matrix,
    save_ranking_chart,
    save_ranking_percentile_bar_chart,
    save_risk_intel_inspiration_figure,
)
from .visuals.l3_decomposition import plot_l3_decomposition
from .visuals.mag7_l3_er import plot_mag7_l3_explained_risk, save_mag7_l3_explained_risk_png
from .visuals.save import (
    save_l3_decomposition_png,
    save_portfolio_attribution_cascade_png,
    save_portfolio_risk_cascade_png,
    write_plotly_png,
)

__all__ = [
    "APIError",
    "AuthError",
    "DataKind",
    "ChatInsights",
    "DataKindLiteral",
    "InsightsNamespace",
    "MatPlotAgent",
    "OutputKind",
    "OutputLiteral",
    "PeerComparison",
    "PeerGroupProxy",
    "PerformanceResult",
    "S1Data",
    "get_data_for_s1",
    "render_s1_to_pdf",
    "S2Data",
    "get_data_for_s2",
    "render_s2_to_pdf",
    "PositionsInput",
    "RefinementResult",
    "RiskLineage",
    "RiskModelsClient",
    "plot_mag7_l3_explained_risk",
    "plot_l3_decomposition",
    "save_l3_decomposition_png",
    "save_mag7_l3_explained_risk_png",
    "save_portfolio_attribution_cascade_png",
    "save_portfolio_risk_cascade_png",
    "write_plotly_png",
    "TimeAxis",
    "TimeLiteral",
    "load_repo_dotenv",
    "attach_sdk_metadata",
    "build_semantic_cheatsheet_md",
    "ensure_dataframe_legend",
    "generate_refined_plot",
    "save_macro_heatmap",
    "save_macro_sensitivity_matrix",
    "save_ranking_chart",
    "save_ranking_percentile_bar_chart",
    "save_risk_intel_inspiration_figure",
    "RiskModelsValidationError",
    "RiskModelsValidationIssue",
    "PortfolioAnalysis",
    "positions_to_weights",
    "format_metrics_snapshot",
    "COMBINED_ERM3_MACRO_LEGEND",
    "RANKINGS_SMALL_COHORT_THRESHOLD",
    "SHORT_ERM3_LEGEND",
    "SHORT_MACRO_CORR_LEGEND",
    "SHORT_RANKINGS_LEGEND",
    "SDK_CONTRIBUTORS",
    "SDKContributorDict",
    "ValidationWarning",
    "to_llm_context",
]

__version__ = "0.3.0"
