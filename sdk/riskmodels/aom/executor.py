"""Execute a compiled ``ExecutionPlanV1`` via ``RiskModelsClient`` (best-effort v1)."""

from __future__ import annotations

import sys
from typing import Any

from ..client import RiskModelsClient
from .plan_schema import (
    AlignComparisonStep,
    ExecutionPlanV1,
    HedgeActionStep,
    ResolveSubjectStep,
    RestFetchStep,
    UnsupportedExecutorStep,
    normalize_execution_plan,
)


def execute_plan(
    client: RiskModelsClient,
    plan: ExecutionPlanV1 | dict[str, Any],
    *,
    debug: bool = False,
) -> dict[str, Any]:
    """Run REST-backed steps from ``compile_plan``.

    ``plan`` may be a typed :class:`ExecutionPlanV1` or a legacy dict (deserialized plan).

    When ``debug=True``, append stderr lines (SDK convention: diagnostics not stdout) and
    include a ``debug`` array on the result.
    """

    typed = normalize_execution_plan(plan)
    dbg: list[str] = []

    def _log(msg: str) -> None:
        if debug:
            line = f"[riskmodels.aom.execute_plan] {msg}"
            print(line, file=sys.stderr, flush=True)
            dbg.append(line)

    steps_out: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []

    comparison_batch: list[Any] = []

    for step in typed.steps:
        if isinstance(step, ResolveSubjectStep):
            _log(f"{step.step_id} resolve_subject type={step.subject.get('type')}")
            steps_out.append({"op": step.op, "step_id": step.step_id, "result": None})
            continue

        if isinstance(step, UnsupportedExecutorStep):
            err = {"step": serialize_step_stub(step), "message": step.reason}
            errors.append(err)
            _log(f"{step.step_id} unsupported: {step.reason}")
            steps_out.append({"op": step.op, "step_id": step.step_id, "error": err})
            continue

        if isinstance(step, AlignComparisonStep):
            aligned = list(comparison_batch)
            comparison_batch = []
            _log(
                f"{step.step_id} align_comparison method={step.method} "
                f"normalize={step.normalize} date_range_shared={step.date_range_shared}"
            )
            steps_out.append(
                {
                    "op": step.op,
                    "step_id": step.step_id,
                    "result": {
                        "method": step.method,
                        "normalize": step.normalize,
                        "date_range_shared": step.date_range_shared,
                        "alignment_echo": step.alignment_echo,
                        "leg_results": aligned,
                    },
                }
            )
            continue

        if isinstance(step, HedgeActionStep):
            name = step.client_method
            method = getattr(client, name, None)
            _log(f"{step.step_id} hedge_action source_step_ref={step.source_step_ref} client_method={name}")
            if method is None:
                errors.append({"step": serialize_step_stub(step), "message": f"unknown client_method {name!r}"})
                steps_out.append({"op": step.op, "step_id": step.step_id, "error": "unknown_method"})
                continue
            try:
                result = method(**dict(step.kwargs))
                steps_out.append(
                    {
                        "op": step.op,
                        "step_id": step.step_id,
                        "client_method": name,
                        "source_step_ref": step.source_step_ref,
                        "selection_rule": step.selection_rule,
                        "result": result,
                    }
                )
            except Exception as e:  # noqa: BLE001
                errors.append({"step": serialize_step_stub(step), "message": str(e)})
                steps_out.append({"op": step.op, "step_id": step.step_id, "error": str(e)})
            continue

        if isinstance(step, RestFetchStep):
            name = step.client_method
            method = getattr(client, name, None)
            _log(f"{step.step_id} rest_fetch {name}(...) binding.parallel_group={step.binding.get('parallel_group')}")
            if method is None:
                errors.append({"step": serialize_step_stub(step), "message": f"unknown client_method {name!r}"})
                steps_out.append({"op": step.op, "step_id": step.step_id, "error": "unknown_method"})
                continue
            try:
                result = method(**dict(step.kwargs))
                entry: dict[str, Any] = {
                    "op": step.op,
                    "step_id": step.step_id,
                    "client_method": name,
                    "result": result,
                }
                if step.binding.get("parallel_group") == "comparison":
                    comparison_batch.append(result)
                steps_out.append(entry)
            except Exception as e:  # noqa: BLE001
                errors.append({"step": serialize_step_stub(step), "message": str(e)})
                steps_out.append({"op": step.op, "step_id": step.step_id, "error": str(e)})
            continue

        errors.append({"step": str(step), "message": "unknown step type"})
        steps_out.append({"error": "unknown_step_type"})

    out: dict[str, Any] = {"plan_version": typed.version, "steps_out": steps_out, "errors": errors}
    if debug:
        out["debug"] = dbg
    return out


def serialize_step_stub(step: Any) -> dict[str, Any]:
    """Minimal step repr for error payloads."""

    from dataclasses import asdict

    try:
        return asdict(step)
    except Exception:
        return {"repr": repr(step)}
