"""Tests for Analysis Object Model compiler, builder, and executor."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from riskmodels import rm, run
from riskmodels.aom import (
    analyze,
    compile_plan,
    execute_plan,
    hedge_action,
    stock,
    validate_aom,
)
from riskmodels.aom.builder import comparison, portfolio_inline
from riskmodels.aom.plan_schema import (
    AlignComparisonStep,
    HedgeActionStep,
    ResolveSubjectStep,
    RestFetchStep,
    serialize_plan,
)
from riskmodels.exceptions import RiskModelsValidationError


def test_validate_rejects_attribution_on_exposure() -> None:
    req = {
        "subject": stock("TSLA"),
        "scope": {},
        "lens": "exposure",
        "attribution_mode": "incremental",
        "resolution": "full_stack",
        "view": "snapshot",
        "output_mode": "structured",
    }
    with pytest.raises(RiskModelsValidationError):
        validate_aom(req)


def test_compile_return_attribution_stock() -> None:
    req = (
        rm()
        .subject(stock("TSLA"))
        .scope(date_range_preset="ytd", as_of="latest")
        .return_attribution(resolution="full_stack", view="timeseries")
        .structured()
    )
    plan = compile_plan(req)
    assert plan.version == "1"
    assert isinstance(plan.steps[0], ResolveSubjectStep)
    assert isinstance(plan.steps[1], RestFetchStep)
    assert plan.steps[1].client_method == "get_ticker_returns"
    sp = serialize_plan(plan)
    assert sp["version"] == "1"
    assert sp["steps"][1]["client_method"] == "get_ticker_returns"


def test_compile_chain_exposure_hedge() -> None:
    req = (
        rm()
        .subject(stock("AAPL"))
        .scope(date_range_preset="mtd")
        .chain(
            analyze(lens="exposure", resolution="full_stack", view="snapshot"),
            hedge_action(depends_on="previous"),
        )
        .structured()
    )
    plan = compile_plan(req)
    ops = [s.op for s in plan.steps]
    assert ops == ["resolve_subject", "rest_fetch", "hedge_action"]
    ha = plan.steps[2]
    assert isinstance(ha, HedgeActionStep)
    assert ha.client_method == "decompose"
    assert ha.source_step_ref == "step_1"


def test_execute_plan_mock() -> None:
    req = (
        rm()
        .subject(stock("MSFT"))
        .scope(date_range_preset="1y")
        .return_attribution(resolution="market_sector", view="timeseries")
        .structured()
    )
    plan = compile_plan(req)
    client = MagicMock()
    client.get_ticker_returns.return_value = object()
    out = execute_plan(client, plan)
    assert not out["errors"]
    client.get_ticker_returns.assert_called_once()
    assert out["steps_out"][-1]["client_method"] == "get_ticker_returns"


def test_execute_plan_debug_stderr_lines(capsys: pytest.CaptureFixture[str]) -> None:
    req = (
        rm()
        .subject(stock("MSFT"))
        .scope(date_range_preset="1y")
        .return_attribution(resolution="market_sector", view="timeseries")
        .structured()
    )
    plan = compile_plan(req)
    client = MagicMock()
    client.get_ticker_returns.return_value = {}
    out = execute_plan(client, plan, debug=True)
    captured = capsys.readouterr()
    assert "[riskmodels.aom.execute_plan]" in captured.err
    assert "debug" in out and len(out["debug"]) >= 1


def test_comparison_compile_two_stocks() -> None:
    req = (
        rm()
        .subject(comparison([stock("XOM"), stock("CVX")], alignment={"date_range": "shared", "normalize": True}))
        .scope(date_range_preset="ytd")
        .return_attribution(resolution="full_stack", view="timeseries")
        .structured()
    )
    plan = compile_plan(req)
    assert sum(1 for s in plan.steps if isinstance(s, RestFetchStep)) == 2
    assert any(isinstance(s, AlignComparisonStep) for s in plan.steps)
    align = next(s for s in plan.steps if isinstance(s, AlignComparisonStep))
    assert align.normalize is True
    assert align.date_range_shared is True


def test_roundtrip_serialized_plan_through_executor() -> None:
    req = (
        rm()
        .subject(stock("MSFT"))
        .scope(date_range_preset="1y")
        .return_attribution(resolution="market_sector", view="timeseries")
        .structured()
    )
    plan = compile_plan(req)
    blob = serialize_plan(plan)
    client = MagicMock()
    client.get_ticker_returns.return_value = {}
    out = execute_plan(client, blob)
    assert not out["errors"]


def test_run_smoke_return_attribution_tsla() -> None:
    req = (
        rm()
        .subject(stock("TSLA"))
        .scope(date_range_preset="ytd", as_of="latest")
        .return_attribution(resolution="full_stack", view="timeseries")
        .structured()
    )
    client = MagicMock()
    client.get_ticker_returns.return_value = {}
    out = run(client, req)
    assert "steps_out" in out and "errors" in out
    assert not out["errors"]
    client.get_ticker_returns.assert_called_once()


def test_run_smoke_comparison_aapl_nvda() -> None:
    req = (
        rm()
        .subject(comparison([stock("AAPL"), stock("NVDA")], alignment={"date_range": "shared"}))
        .scope(date_range_preset="ytd")
        .return_attribution(resolution="full_stack", view="timeseries")
        .structured()
    )
    client = MagicMock()
    client.get_ticker_returns.return_value = {}
    out = run(client, req)
    assert not out["errors"]
    assert client.get_ticker_returns.call_count == 2


def test_run_smoke_exposure_snapshot_nvda() -> None:
    req = (
        rm()
        .subject(stock("NVDA"))
        .scope(date_range_preset="ytd")
        .exposure(resolution="full_stack", view="snapshot")
        .explain()
    )
    client = MagicMock()
    client.get_metrics.return_value = {}
    out = run(client, req)
    assert not out["errors"]
    client.get_metrics.assert_called_once()


def test_run_smoke_chain_exposure_hedge() -> None:
    req = (
        rm()
        .subject(stock("AAPL"))
        .scope(date_range_preset="mtd")
        .chain(
            analyze(lens="exposure", resolution="full_stack", view="snapshot"),
            hedge_action(depends_on="previous"),
        )
        .structured()
    )
    client = MagicMock()
    client.get_metrics.return_value = {}
    client.decompose.return_value = {}
    out = run(client, req)
    assert not out["errors"]
    client.get_metrics.assert_called_once()
    client.decompose.assert_called_once()


def test_compile_portfolio_single_risk_decomposition() -> None:
    req = (
        rm()
        .subject(portfolio_inline([
            {"ticker": "AAPL", "weight": 0.5},
            {"ticker": "MSFT", "weight": 0.5},
        ]))
        .scope(date_range_preset="ytd", as_of="latest")
        .risk_decomposition(resolution="full_stack", view="snapshot")
        .structured()
    )
    plan = compile_plan(req)
    ops = [s.op for s in plan.steps]
    assert ops == ["resolve_subject", "rest_fetch"]
    fetch = plan.steps[1]
    assert isinstance(fetch, RestFetchStep)
    assert fetch.client_method == "snapshot"
    assert len(fetch.kwargs["positions"]) == 2
    assert fetch.kwargs["lookback_days"] == 252


def test_compile_portfolio_chain_risk_hedge() -> None:
    req = (
        rm()
        .subject(portfolio_inline([
            {"ticker": "TSLA", "weight": 0.20},
            {"ticker": "NVDA", "weight": 0.15},
            {"ticker": "AAPL", "weight": 0.65},
        ]))
        .scope(date_range_preset="ytd", as_of="latest")
        .chain(
            analyze(lens="risk_decomposition", resolution="full_stack", view="snapshot"),
            hedge_action(depends_on="previous"),
        )
        .structured()
    )
    plan = compile_plan(req)
    # Portfolio chain collapses to one snapshot call (no fan-out, no second hedge call)
    ops = [s.op for s in plan.steps]
    assert ops == ["resolve_subject", "rest_fetch"]
    fetch = plan.steps[1]
    assert isinstance(fetch, RestFetchStep)
    assert fetch.client_method == "snapshot"
    assert len(fetch.kwargs["positions"]) == 3
    chain_meta = fetch.binding.get("chain")
    assert chain_meta is not None
    assert chain_meta[0]["kind"] == "analyze"
    assert chain_meta[1]["kind"] == "hedge_action"


def test_run_portfolio_chain_mock() -> None:
    req = (
        rm()
        .subject(portfolio_inline([
            {"ticker": "AAPL", "weight": 0.4},
            {"ticker": "MSFT", "weight": 0.6},
        ]))
        .scope(date_range_preset="ytd", as_of="latest")
        .chain(
            analyze(lens="risk_decomposition", resolution="full_stack", view="snapshot"),
            hedge_action(depends_on="previous"),
        )
        .structured()
    )
    client = MagicMock()
    client.snapshot.return_value = (
        {"snapshot": {"variance_decomposition": {"market": 0.6, "sector": 0.2,
                                                  "subsector": 0.1, "residual": 0.1,
                                                  "systematic": 0.9}}},
        MagicMock(),
    )
    out = run(client, req)
    assert not out["errors"]
    client.snapshot.assert_called_once()
    call_kwargs = client.snapshot.call_args.kwargs
    assert len(call_kwargs["positions"]) == 2
    assert call_kwargs["lookback_days"] == 252


def test_compile_portfolio_lookback_from_preset() -> None:
    cases = {"mtd": 21, "ytd": 252, "1y": 252, "3y": 756, "5y": 1260}
    for preset, expected in cases.items():
        req = (
            rm()
            .subject(portfolio_inline([{"ticker": "AAPL", "weight": 1.0}]))
            .scope(date_range_preset=preset)
            .risk_decomposition(resolution="full_stack", view="snapshot")
            .structured()
        )
        plan = compile_plan(req)
        fetch = plan.steps[1]
        assert isinstance(fetch, RestFetchStep)
        assert fetch.kwargs["lookback_days"] == expected, f"preset {preset}"


def test_run_debug_stderr_aom_and_plan(capsys: pytest.CaptureFixture[str]) -> None:
    req = (
        rm()
        .subject(stock("MSFT"))
        .scope(date_range_preset="1y")
        .return_attribution(resolution="market_sector", view="timeseries")
        .structured()
    )
    client = MagicMock()
    client.get_ticker_returns.return_value = {}
    run(client, req, debug=True)
    err = capsys.readouterr().err
    assert "=== AOM REQUEST ===" in err
    assert "=== EXECUTION PLAN ===" in err
