"""ExecutionPlan v1 — first-class typed steps (compiler output, executor input).

This is **not** part of the Analysis Object Model payload; it is the SDK-internal
translation layer between validated ``AOMRequest`` and ``RiskModelsClient`` calls.

Alignment and hedge metadata are explicit so agents and debugging stay traceable
without leaking REST paths into AOM.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, cast

# --- Step discriminant (explicit ops; extensible with new dataclass types) ---


@dataclass(frozen=True)
class ResolveSubjectStep:
    """Subject identity for logging / future portfolio expansion."""

    step_id: str
    subject: dict[str, Any]
    op: Literal["resolve_subject"] = "resolve_subject"


@dataclass(frozen=True)
class RestFetchStep:
    """Call a ``RiskModelsClient`` method with deterministic kwargs."""

    step_id: str
    client_method: str
    kwargs: dict[str, Any]
    binding: dict[str, Any]
    op: Literal["rest_fetch"] = "rest_fetch"


@dataclass(frozen=True)
class AlignComparisonStep:
    """Post-hoc alignment of independently fetched comparison legs (see ``AOM_SPEC``).

    ``method`` names the join/normalization strategy implemented in executor/product code.
    v1 default: calendar inner-join on trading dates; missing dates → NaN per pandas merge semantics.
    """

    step_id: str
    alignment_echo: dict[str, Any]
    method: Literal["inner_join_on_date"] = "inner_join_on_date"
    normalize: bool | None = None
    date_range_shared: bool = False
    op: Literal["align_comparison"] = "align_comparison"


@dataclass(frozen=True)
class HedgeActionStep:
    """Hedge / decompose leg with traceability back to prior analyze output."""

    step_id: str
    depends_on: str
    source_step_ref: str
    selection_rule: Literal["compiler_default_prior_analyze"]
    client_method: str
    kwargs: dict[str, Any]
    chain_stage_index: int | None = None
    op: Literal["hedge_action"] = "hedge_action"


@dataclass(frozen=True)
class UnsupportedExecutorStep:
    """Explicit placeholder until portfolio/universe/etc. executors land."""

    step_id: str
    reason: str
    subject_type: str | None = None
    leg_index: int | None = None
    op: Literal["unsupported_executor_v1"] = "unsupported_executor_v1"


ExecutionStep = (
    ResolveSubjectStep
    | RestFetchStep
    | AlignComparisonStep
    | HedgeActionStep
    | UnsupportedExecutorStep
)


@dataclass
class ExecutionPlanV1:
    """Typed execution plan (version 1). Prefer this over ad hoc dicts."""

    steps: tuple[ExecutionStep, ...]
    version: Literal["1"] = "1"


def serialize_plan(plan: ExecutionPlanV1) -> dict[str, Any]:
    """JSON-friendly dict (e.g. logging, golden tests)."""

    return {"version": plan.version, "steps": [serialize_step(s) for s in plan.steps]}


def serialize_step(step: ExecutionStep) -> dict[str, Any]:
    from dataclasses import asdict

    return asdict(step)


def execution_plan_from_mapping(plan: dict[str, Any]) -> ExecutionPlanV1:
    """Best-effort deserialize from legacy dict plans (tests / saved artifacts)."""

    if plan.get("version") != "1":
        raise ValueError(f"Unsupported ExecutionPlan version: {plan.get('version')!r}")
    raw_steps = plan.get("steps") or []
    parsed: list[ExecutionStep] = []
    for rs in raw_steps:
        op = rs.get("op")
        if op == "resolve_subject":
            parsed.append(
                ResolveSubjectStep(step_id=str(rs.get("step_id", "")), subject=dict(rs.get("subject") or {}))
            )
        elif op == "rest_fetch":
            parsed.append(
                RestFetchStep(
                    step_id=str(rs["step_id"]),
                    client_method=str(rs["client_method"]),
                    kwargs=dict(rs.get("kwargs") or {}),
                    binding=dict(rs.get("binding") or {}),
                )
            )
        elif op == "align_comparison":
            m = rs.get("method") or "inner_join_on_date"
            parsed.append(
                AlignComparisonStep(
                    step_id=str(rs.get("step_id", "step_align")),
                    alignment_echo=dict(rs.get("alignment_echo") or rs.get("alignment") or {}),
                    method=cast(Literal["inner_join_on_date"], m),
                    normalize=rs.get("normalize"),
                    date_range_shared=bool(rs.get("date_range_shared", False)),
                )
            )
        elif op == "hedge_action":
            sr_def: Literal["compiler_default_prior_analyze"] = "compiler_default_prior_analyze"
            sel = rs.get("selection_rule") or sr_def
            parsed.append(
                HedgeActionStep(
                    step_id=str(rs["step_id"]),
                    depends_on=str(rs.get("depends_on", "previous")),
                    source_step_ref=str(rs.get("source_step_ref", "")),
                    selection_rule=cast(Literal["compiler_default_prior_analyze"], sel),
                    client_method=str(rs.get("client_method", "decompose")),
                    kwargs=dict(rs.get("kwargs") or {}),
                    chain_stage_index=rs.get("chain_stage_index"),
                )
            )
        elif op == "unsupported_executor_v1":
            parsed.append(
                UnsupportedExecutorStep(
                    step_id=str(rs.get("step_id", "")),
                    reason=str(rs.get("reason", "")),
                    subject_type=rs.get("subject_type"),
                    leg_index=rs.get("leg_index"),
                )
            )
        else:
            raise ValueError(f"Unknown step op: {op!r}")
    return ExecutionPlanV1(steps=tuple(parsed))


def normalize_execution_plan(plan: ExecutionPlanV1 | dict[str, Any]) -> ExecutionPlanV1:
    """Accept typed plan or legacy dict."""

    if isinstance(plan, ExecutionPlanV1):
        return plan
    return execution_plan_from_mapping(plan)
