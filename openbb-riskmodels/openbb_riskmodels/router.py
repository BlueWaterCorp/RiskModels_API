"""OpenBB core-extension router: ``obb.risk_models.*``.

``cc`` is injected by OpenBB by parameter name (see openbb-core
CommandRunner.update_command_context). Annotated as Any so a Pydantic
forward-reference on CommandContext cannot break command registration.
"""

from __future__ import annotations

from typing import Any

from openbb_core.app.model.obbject import OBBject
from openbb_core.app.router import Router

from openbb_riskmodels.credentials import resolve_api_key
from openbb_riskmodels.mapping import (
    map_decompose,
    map_decompose_historical,
    map_fundamentals,
)

router = Router(prefix="", description="RiskModels ERM3 risk and PIT fundamentals.")


def _client(cc: Any | None):
    from riskmodels import RiskModelsClient

    api_key = resolve_api_key(cc)
    if api_key:
        return RiskModelsClient(api_key=api_key)
    return RiskModelsClient.from_env()


@router.command(methods=["GET"], no_validate=True)
def decompose(symbol: str, cc: Any = None) -> OBBject:
    """ERM3 risk decomposition for one ticker (latest model date).

    Four additive layers — market, sector, subsector, residual — each with
    explained-risk share and hedge ratio, plus the consolidated hedge map
    (dollars of ETF per $1 long stock). Residual is unexplained variance.
    """
    payload = _client(cc).decompose(symbol.upper())
    if not isinstance(payload, dict):
        raise TypeError("client.decompose must return a dict when as_dataframe is False")
    return OBBject(results=map_decompose(payload))


@router.command(methods=["GET"], no_validate=True)
def decompose_historical(symbol: str, years: int = 5, cc: Any = None) -> OBBject:
    """Historical ERM3 explained-risk and hedge-ratio series for one ticker."""
    df = _client(cc).get_l3_decomposition(symbol.upper(), years=years)
    records = df.to_dict("records") if hasattr(df, "to_dict") else list(df)
    return OBBject(results=map_decompose_historical(records))


@router.command(methods=["GET"], no_validate=True)
def fundamentals(
    symbol: str,
    periods: int = 8,
    as_of: str | None = None,
    erp: float = 0.05,
    tax_rate: float = 0.21,
    rf_tenor: str = "10y",
    cc: Any = None,
) -> OBBject:
    """Point-in-time quarterly fundamentals for one ticker.

    A row is visible iff its filed_date is on or before as_of. Rows keep
    filed_date, filed_date_source, and sec_facts (SEC XBRL cells only).
    """
    df = _client(cc).get_fundamentals(
        symbol.upper(),
        periods=periods,
        as_of=as_of,
        erp=erp,
        tax_rate=tax_rate,
        rf_tenor=rf_tenor,  # type: ignore[arg-type]
        as_dataframe=True,
    )
    records = df.to_dict("records") if hasattr(df, "to_dict") else list(df)
    return OBBject(results=map_fundamentals(records))
