"""Thin runtime: compile AOM request and execute plan (no builder/compiler/executor changes)."""

from __future__ import annotations

import sys
from typing import Any

from ..client import RiskModelsClient
from .compiler import compile_plan
from .executor import execute_plan
from .types import AOMRequest


def run(client: RiskModelsClient, req: AOMRequest, debug: bool = False) -> dict[str, Any]:
    """Execute an AOM request end-to-end.

    Steps:

    1. Compile ``AOMRequest`` → execution plan
    2. Execute plan via :func:`execute_plan`

    Args:
        client: ``RiskModelsClient`` instance.
        req: Validated single or chain AOM request from the builder.
        debug: If ``True``, print request and plan to **stderr** (stdout stays clean for notebooks/agents).

    Returns:
        Same dict as :func:`execute_plan` (``plan_version``, ``steps_out``, ``errors``, optional ``debug``).
    """
    plan = compile_plan(req)
    if debug:
        print("=== AOM REQUEST ===", file=sys.stderr, flush=True)
        print(req, file=sys.stderr, flush=True)
        print("=== EXECUTION PLAN ===", file=sys.stderr, flush=True)
        print(plan, file=sys.stderr, flush=True)
    return execute_plan(client, plan, debug=debug)
