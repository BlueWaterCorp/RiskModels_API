"""Compile ``AOMRequest`` → :class:`ExecutionPlanV1` (typed steps)."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, cast

from ..exceptions import RiskModelsValidationError
from .plan_schema import (
    AlignComparisonStep,
    ExecutionPlanV1,
    ExecutionStep,
    HedgeActionStep,
    ResolveSubjectStep,
    RestFetchStep,
    UnsupportedExecutorStep,
)
from .types import (
    ATTRIBUTION_LENSES,
    AOMChainRequest,
    AOMRequest,
    AOMSingleRequest,
    Lens,
    Resolution,
    Scope,
    Subject,
    View,
    is_chain_request,
)

_PRESET_YEARS: dict[str, int] = {"ytd": 1, "mtd": 1, "1y": 1, "5y": 5, "3y": 3}


def validate_aom(req: AOMRequest) -> None:
    """Raise ``RiskModelsValidationError`` when the request violates AOM v1 rules."""

    if is_chain_request(req):
        cr = cast(AOMChainRequest, req)
        chain = cr.get("chain") or []
        if not chain:
            raise RiskModelsValidationError("chain request requires a non-empty chain array.")
        _validate_subject(cr.get("subject"))
        if cr.get("output_mode") is None:
            raise RiskModelsValidationError(
                "output_mode is required.", fix="Use .structured(), .explain(), or .visual()."
            )
        for i, stage in enumerate(chain):
            k = stage.get("kind")
            if k not in ("analyze", "hedge_action"):
                raise RiskModelsValidationError(
                    f"Invalid chain stage at index {i}: kind must be 'analyze' or 'hedge_action'.",
                    fix='Use analyze(lens=...) or hedge_action(depends_on="previous").',
                )
            if k == "analyze":
                if not stage.get("lens"):
                    raise RiskModelsValidationError(f"analyze stage at index {i} requires lens.")
                lens = cast(Lens, stage["lens"])
                am = stage.get("attribution_mode")
                if am is not None and lens not in ATTRIBUTION_LENSES:
                    raise RiskModelsValidationError(
                        f"attribution_mode is only valid for return_attribution/risk_decomposition (stage {i}).",
                    )
        return

    sr = cast(AOMSingleRequest, req)
    _validate_subject(sr.get("subject"))
    if sr.get("lens") is None:
        raise RiskModelsValidationError("lens is required.")
    if sr.get("resolution") is None:
        raise RiskModelsValidationError("resolution is required.")
    if sr.get("view") is None:
        raise RiskModelsValidationError("view is required.")
    if sr.get("output_mode") is None:
        raise RiskModelsValidationError(
            "output_mode is required.", fix="Use .structured(), .explain(), or .visual()."
        )
    lens = cast(Lens, sr["lens"])
    am = sr.get("attribution_mode")
    if am is not None and lens not in ATTRIBUTION_LENSES:
        raise RiskModelsValidationError(
            "attribution_mode is only valid when lens is return_attribution or risk_decomposition.",
            fix="Remove attribution_mode for exposure, or change lens.",
        )


def _validate_subject(subject: Subject | None) -> None:
    if subject is None:
        raise RiskModelsValidationError("subject is required.")
    st = subject.get("type")
    if st == "stock":
        if not subject.get("ticker") and not subject.get("symbol"):
            raise RiskModelsValidationError("stock subject requires ticker or symbol.")
    elif st == "portfolio":
        src = subject.get("source")
        if src == "inline":
            if not subject.get("holdings"):
                raise RiskModelsValidationError("inline portfolio requires holdings.")
        elif src == "id":
            if not subject.get("portfolio_id"):
                raise RiskModelsValidationError("portfolio id subject requires portfolio_id.")
        else:
            raise RiskModelsValidationError("portfolio subject requires source 'inline' or 'id'.")
    elif st == "universe":
        if not subject.get("universe_id"):
            raise RiskModelsValidationError("universe subject requires universe_id.")
    elif st == "comparison":
        subs = subject.get("subjects") or []
        if len(subs) < 2:
            raise RiskModelsValidationError("comparison requires at least two nested subjects.")
    else:
        raise RiskModelsValidationError(f"Unknown subject type: {st!r}.")


def compile_plan(req: AOMRequest) -> ExecutionPlanV1:
    """Produce a deterministic typed execution plan (no HTTP)."""

    validate_aom(req)
    if is_chain_request(req):
        return _compile_chain(cast(AOMChainRequest, req))
    return _compile_single(cast(AOMSingleRequest, req))


def _step_ids() -> Callable[[], str]:
    n = 0

    def next_id() -> str:
        nonlocal n
        sid = f"step_{n}"
        n += 1
        return sid

    return next_id


def _years_from_scope(scope: Scope) -> int:
    dr = scope.get("date_range")
    if isinstance(dr, dict) and "preset" in dr:
        return _PRESET_YEARS.get(str(dr["preset"]), 1)
    return 1


def _as_of_optional(scope: Scope) -> str | None:
    ao = scope.get("as_of")
    if ao is None or ao == "latest":
        return None
    return str(ao)


def _fetch_step_for_stock(
    step_id: str,
    ticker: str,
    *,
    lens: Lens,
    resolution: Resolution,
    view: View,
    attribution_mode: str | None,
    scope: Scope,
    parallel_group: str | None = None,
    leg_index: int | None = None,
    chain_stage_index: int | None = None,
) -> RestFetchStep:
    years = _years_from_scope(scope)
    as_of = _as_of_optional(scope)

    base_meta: dict[str, Any] = {
        "ticker": ticker,
        "lens": lens,
        "resolution": resolution,
        "view": view,
        "attribution_mode": attribution_mode,
        "scope": dict(scope),
    }
    if parallel_group is not None:
        base_meta["parallel_group"] = parallel_group
    if leg_index is not None:
        base_meta["leg_index"] = leg_index
    if chain_stage_index is not None:
        base_meta["chain_stage_index"] = chain_stage_index

    if lens == "return_attribution":
        return RestFetchStep(
            step_id=step_id,
            client_method="get_ticker_returns",
            kwargs={"ticker": ticker, "years": years},
            binding=base_meta,
        )

    if lens == "risk_decomposition":
        kwargs: dict[str, Any] = {"ticker": ticker}
        if years != 1:
            kwargs["years"] = years
        if as_of:
            kwargs["as_of"] = as_of
        return RestFetchStep(
            step_id=step_id,
            client_method="get_l3_decomposition",
            kwargs=kwargs,
            binding=base_meta,
        )

    if view == "snapshot":
        return RestFetchStep(
            step_id=step_id,
            client_method="get_metrics",
            kwargs={"ticker": ticker, "as_dataframe": False},
            binding=base_meta,
        )

    return RestFetchStep(
        step_id=step_id,
        client_method="get_l3_decomposition",
        kwargs={"ticker": ticker, "years": max(years, 2)},
        binding=base_meta,
    )


def _compile_single(req: AOMSingleRequest) -> ExecutionPlanV1:
    nid = _step_ids()
    subject = req["subject"]
    scope = req.get("scope") or {}
    lens = cast(Lens, req["lens"])
    resolution = cast(Resolution, req["resolution"])
    view = cast(View, req["view"])
    attribution_mode = req.get("attribution_mode")

    steps_list: list[ExecutionStep] = [ResolveSubjectStep(step_id=nid(), subject=dict(subject))]

    stype = subject.get("type")
    if stype == "comparison":
        legs = list(subject.get("subjects") or [])
        alignment = dict(subject.get("alignment") or {})
        for i, leg in enumerate(legs):
            if leg.get("type") != "stock":
                steps_list.append(
                    UnsupportedExecutorStep(
                        step_id=nid(),
                        reason="comparison legs must be stock subjects in executor v1",
                        leg_index=i,
                    )
                )
                continue
            lt = str(leg.get("ticker") or leg.get("symbol"))
            steps_list.append(
                _fetch_step_for_stock(
                    nid(),
                    lt,
                    lens=lens,
                    resolution=resolution,
                    view=view,
                    attribution_mode=attribution_mode,
                    scope=dict(scope),
                    parallel_group="comparison",
                    leg_index=i,
                )
            )
        steps_list.append(
            AlignComparisonStep(
                step_id=nid(),
                alignment_echo=alignment,
                method="inner_join_on_date",
                normalize=alignment.get("normalize") if "normalize" in alignment else None,
                date_range_shared=alignment.get("date_range") == "shared",
            )
        )
        return ExecutionPlanV1(steps=tuple(steps_list))

    if stype != "stock":
        steps_list.append(
            UnsupportedExecutorStep(
                step_id=nid(),
                reason="Executor v1 implements stock tickers (and stock-only comparisons).",
                subject_type=str(stype),
            )
        )
        return ExecutionPlanV1(steps=tuple(steps_list))

    ticker = str(subject.get("ticker") or subject.get("symbol"))
    steps_list.append(
        _fetch_step_for_stock(
            nid(),
            ticker,
            lens=lens,
            resolution=resolution,
            view=view,
            attribution_mode=attribution_mode,
            scope=dict(scope),
        )
    )
    return ExecutionPlanV1(steps=tuple(steps_list))


def _compile_chain(req: AOMChainRequest) -> ExecutionPlanV1:
    nid = _step_ids()
    subject = req["subject"]
    scope = req.get("scope") or {}
    steps_list: list[ExecutionStep] = [ResolveSubjectStep(step_id=nid(), subject=dict(subject))]

    if subject.get("type") != "stock":
        steps_list.append(
            UnsupportedExecutorStep(
                step_id=nid(),
                reason="chain executor v1 requires a stock subject.",
                subject_type=str(subject.get("type")),
            )
        )
        return ExecutionPlanV1(steps=tuple(steps_list))

    ticker = str(subject.get("ticker") or subject.get("symbol"))
    last_analyze_step_id: str | None = None

    for i, stage in enumerate(req.get("chain") or []):
        sk = stage.get("kind")
        if sk == "analyze":
            lens = cast(Lens, stage["lens"])
            resolution = cast(Resolution, stage.get("resolution") or "full_stack")
            view = cast(View, stage.get("view") or "snapshot")
            am = stage.get("attribution_mode")
            sid = nid()
            fetch = _fetch_step_for_stock(
                sid,
                ticker,
                lens=lens,
                resolution=resolution,
                view=view,
                attribution_mode=am,
                scope=dict(scope),
                chain_stage_index=i,
            )
            steps_list.append(fetch)
            last_analyze_step_id = sid
        elif sk == "hedge_action":
            dep = str(stage.get("depends_on", "previous"))
            src = last_analyze_step_id or "step_unknown"
            steps_list.append(
                HedgeActionStep(
                    step_id=nid(),
                    depends_on=dep,
                    source_step_ref=src,
                    selection_rule="compiler_default_prior_analyze",
                    client_method="decompose",
                    kwargs={"ticker": ticker, "as_dataframe": False},
                    chain_stage_index=i,
                )
            )

    return ExecutionPlanV1(steps=tuple(steps_list))


# Back-compat alias for imports expecting the old name
ExecutionPlan = ExecutionPlanV1
