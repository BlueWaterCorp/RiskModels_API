"""RiskModels API — Python SDK (ERM3 hedge ratios and explained risk)."""

from .client import RiskModelsClient
from .exceptions import (
    APIError,
    AuthError,
    RiskModelsValidationError,
    RiskModelsValidationIssue,
    ValidationWarning,
)
from .legends import SHORT_ERM3_LEGEND
from .lineage import RiskLineage
from .llm import to_llm_context
from .metadata_attach import (
    attach_sdk_metadata,
    build_semantic_cheatsheet_md,
    ensure_dataframe_legend,
)
from .portfolio_math import PortfolioAnalysis

__all__ = [
    "APIError",
    "AuthError",
    "RiskLineage",
    "RiskModelsClient",
    "attach_sdk_metadata",
    "build_semantic_cheatsheet_md",
    "ensure_dataframe_legend",
    "RiskModelsValidationError",
    "RiskModelsValidationIssue",
    "PortfolioAnalysis",
    "SHORT_ERM3_LEGEND",
    "ValidationWarning",
    "to_llm_context",
]

__version__ = "0.2.0"
