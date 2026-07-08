"""AOM `.with_fundamentals()` chain stage (H.89.6).

Compiles to a `RestFetchStep` calling `client.get_fundamentals(...,
as_dataframe=True)` — no executor changes needed (RestFetchStep already
dispatches via getattr(client, client_method)). See sdk/riskmodels/aom/
compiler.py `_compile_chain` and builder.py `with_fundamentals`/`fundamentals`.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pandas as pd
import pytest

from riskmodels import rm, run
from riskmodels.aom import analyze, compile_plan, fundamentals, hedge_action, stock, validate_aom
from riskmodels.aom.plan_schema import RestFetchStep
from riskmodels.exceptions import RiskModelsValidationError


def test_with_fundamentals_alone_compiles_to_get_fundamentals_rest_fetch() -> None:
    req = rm().subject(stock("AAPL")).scope(date_range_preset="1y").with_fundamentals().structured()
    plan = compile_plan(req)
    ops = [s.op for s in plan.steps]
    assert ops == ["resolve_subject", "rest_fetch"]
    fetch = plan.steps[1]
    assert isinstance(fetch, RestFetchStep)
    assert fetch.client_method == "get_fundamentals"
    assert fetch.kwargs == {"ticker": "AAPL", "as_dataframe": True}
    assert fetch.binding["kind"] == "fundamentals"


def test_with_fundamentals_passes_cost_of_capital_overrides() -> None:
    req = (
        rm()
        .subject(stock("AAPL"))
        .scope(date_range_preset="1y")
        .with_fundamentals(erp=0.06, tax_rate=0.25, rf_tenor="1y", periods=4)
        .structured()
    )
    plan = compile_plan(req)
    fetch = plan.steps[1]
    assert isinstance(fetch, RestFetchStep)
    assert fetch.kwargs == {
        "ticker": "AAPL",
        "as_dataframe": True,
        "erp": 0.06,
        "tax_rate": 0.25,
        "rf_tenor": "1y",
        "periods": 4,
    }


def test_with_fundamentals_appends_onto_an_existing_analyze_chain() -> None:
    req = (
        rm()
        .subject(stock("AAPL"))
        .scope(date_range_preset="mtd")
        .chain(analyze(lens="exposure", resolution="full_stack", view="snapshot"))
        .with_fundamentals()
        .structured()
    )
    plan = compile_plan(req)
    ops = [s.op for s in plan.steps]
    assert ops == ["resolve_subject", "rest_fetch", "rest_fetch"]
    fundamentals_step = plan.steps[2]
    assert isinstance(fundamentals_step, RestFetchStep)
    assert fundamentals_step.client_method == "get_fundamentals"


def test_with_fundamentals_coexists_with_hedge_action_in_a_chain() -> None:
    req = (
        rm()
        .subject(stock("AAPL"))
        .scope(date_range_preset="mtd")
        .chain(
            analyze(lens="exposure", resolution="full_stack", view="snapshot"),
            hedge_action(depends_on="previous"),
        )
        .with_fundamentals()
        .structured()
    )
    plan = compile_plan(req)
    ops = [s.op for s in plan.steps]
    assert ops == ["resolve_subject", "rest_fetch", "hedge_action", "rest_fetch"]


def test_fundamentals_chain_stage_kind_passes_validation() -> None:
    req = {
        "subject": stock("AAPL"),
        "scope": {},
        "chain": [fundamentals()],
        "output_mode": "structured",
    }
    validate_aom(req)  # no raise


def test_invalid_chain_stage_kind_error_mentions_fundamentals() -> None:
    req = {
        "subject": stock("AAPL"),
        "scope": {},
        "chain": [{"kind": "bogus"}],
        "output_mode": "structured",
    }
    with pytest.raises(RiskModelsValidationError, match="fundamentals"):
        validate_aom(req)


def test_execute_plan_runs_get_fundamentals_and_rides_to_llm_context() -> None:
    from riskmodels.aom.executor import execute_plan
    from riskmodels.llm import to_llm_context

    df = pd.DataFrame([{"period_end_date": "2025-09-30", "roe_ttm": 1.6}])
    df.attrs["legend"] = "ERM3 legend stub"

    req = rm().subject(stock("AAPL")).scope(date_range_preset="1y").with_fundamentals().structured()
    plan = compile_plan(req)
    client = MagicMock()
    client.get_fundamentals.return_value = df

    out = execute_plan(client, plan)
    assert not out["errors"]
    client.get_fundamentals.assert_called_once_with(ticker="AAPL", as_dataframe=True)
    fundamentals_result = out["steps_out"][-1]["result"]
    assert fundamentals_result is df
    # Generic DataFrame dispatch — no fundamentals-specific code in llm.py required.
    md = to_llm_context(fundamentals_result)
    assert "roe_ttm" in md


def test_run_end_to_end_with_mocked_client() -> None:
    req = rm().subject(stock("MSFT")).scope(date_range_preset="1y").with_fundamentals().structured()
    client = MagicMock()
    client.get_fundamentals.return_value = pd.DataFrame([{"roe_ttm": 0.4}])
    out = run(client, req)
    assert not out["errors"]
    assert out["steps_out"][-1]["client_method"] == "get_fundamentals"
