"""RiskModels API — Python SDK (ERM3 hedge ratios and explained risk)."""

from .client import RiskModelsClient
from .exceptions import (
    APIError,
    AuthError,
    RiskModelsValidationError,
    RiskModelsValidationIssue,
    ValidationWarning,
)
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
from .portfolio_math import PortfolioAnalysis
from .visual_refinement import (
    MatPlotAgent,
    RefinementResult,
    generate_refined_plot,
    save_macro_heatmap,
    save_ranking_chart,
    save_ranking_percentile_bar_chart,
)

__all__ = [
    "APIError",
    "AuthError",
    "MatPlotAgent",
    "RefinementResult",
    "RiskLineage",
    "RiskModelsClient",
    "attach_sdk_metadata",
    "build_semantic_cheatsheet_md",
    "ensure_dataframe_legend",
    "generate_refined_plot",
    "save_macro_heatmap",
    "save_ranking_chart",
    "save_ranking_percentile_bar_chart",
    "RiskModelsValidationError",
    "RiskModelsValidationIssue",
    "PortfolioAnalysis",
    "COMBINED_ERM3_MACRO_LEGEND",
    "RANKINGS_SMALL_COHORT_THRESHOLD",
    "SHORT_ERM3_LEGEND",
    "SHORT_MACRO_CORR_LEGEND",
    "SHORT_RANKINGS_LEGEND",
    "ValidationWarning",
    "to_llm_context",
]

__version__ = "0.2.4"
