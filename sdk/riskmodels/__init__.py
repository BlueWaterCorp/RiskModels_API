"""RiskModels API — Python SDK (decompose US equities: variance shares, ETF hedge ratios, ERM3).

Contributor recognition is shipped in-package: see ``SDK_CONTRIBUTORS`` and
``RiskModelsClient.discover()`` (Markdown / JSON includes a ``contributors`` list).
"""

from . import aom
from .aom import rm, run
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
from .mapping import extract_hedge_levels
from .metadata_attach import (
    attach_sdk_metadata,
    build_semantic_cheatsheet_md,
    ensure_dataframe_legend,
)
from .notebook import GET_KEY_URL, ensure_riskmodels_api_key, load_notebook_dotenv, quickstart_connect
from .metrics_snapshot import format_metrics_snapshot
from .pair_trade import PairTradeNeutralization, compute_pair_neutralization
from .peer_group import PeerComparison, PeerGroupProxy
from .performance.base import PerformanceResult
from .portfolio_math import PortfolioAnalysis, PositionsInput, positions_to_weights
from .snapshots import (  # noqa: F401
    CanonicalStockSnapshot,
    P1Data,
    StockContext,
    cumulative_returns,
    fetch_stock_context,
    from_components,
    from_dd_data,
    get_data_for_p1,
    max_drawdown_series,
    relative_returns,
    render_canonical_to_pdf,
    render_canonical_to_png,
    render_canonical_to_png_bytes,
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
try:
    from .visuals.l3_decomposition import plot_l3_year_end_stack
except ImportError:  # pragma: no cover — older installs / partial checkouts

    def plot_l3_year_end_stack(*args: object, **kwargs: object) -> object:
        raise ImportError(
            "`plot_l3_year_end_stack` needs riskmodels-py 0.3.3+ (viz extra). "
            'pip install -U "riskmodels-py[viz]>=0.3.3" '
            'or pip install -U "riskmodels-py[viz] @ git+https://github.com/BlueWaterCorp/RiskModels_API.git@main#subdirectory=sdk" '
            "(monorepo: pip install -e ./sdk[viz])."
        )

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
    "PairTradeNeutralization",
    "compute_pair_neutralization",
    "PeerComparison",
    "PeerGroupProxy",
    "PerformanceResult",
    "CanonicalStockSnapshot",
    "P1Data",
    "from_components",
    "from_dd_data",
    "get_data_for_p1",
    "render_canonical_to_pdf",
    "render_canonical_to_png",
    "render_canonical_to_png_bytes",
    "PositionsInput",
    "RefinementResult",
    "RiskLineage",
    "RiskModelsClient",
    "plot_l3_decomposition",
    "plot_l3_year_end_stack",
    "save_l3_decomposition_png",
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
    "GET_KEY_URL",
    "ensure_riskmodels_api_key",
    "load_notebook_dotenv",
    "quickstart_connect",
    "save_macro_heatmap",
    "save_macro_sensitivity_matrix",
    "save_ranking_chart",
    "save_ranking_percentile_bar_chart",
    "save_risk_intel_inspiration_figure",
    "RiskModelsValidationError",
    "RiskModelsValidationIssue",
    "PortfolioAnalysis",
    "positions_to_weights",
    "extract_hedge_levels",
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
    "aom",
    "rm",
    "run",
]

__version__ = "0.3.6"
