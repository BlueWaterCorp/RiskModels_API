"""OpenBB provider registration — credentials only.

Do not attach fetchers for OpenBB standard models (in particular
``EquityFundamentalMetrics``). Fundamentals are a dedicated
``obb.risk_models.fundamentals`` command on the core-extension router.
The provider exists so OpenBB's credential store exposes
``riskmodels_api_key``.
"""

from openbb_core.provider.abstract.provider import Provider

riskmodels_provider = Provider(
    name="riskmodels",
    website="https://riskmodels.app",
    description=(
        "RiskModels.app — point-in-time normalized fundamentals derived from "
        "SEC filings and licensed sources, and hierarchical (ERM3) risk "
        "decomposition. Filing-date gated. https://riskmodels.app/docs/api"
    ),
    credentials=["api_key"],
    fetcher_dict={},
)
