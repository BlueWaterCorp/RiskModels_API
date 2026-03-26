"""ERM3 explained-risk sum checks (L3 ER). Hedge-ratio signs are not validated."""

from __future__ import annotations

import warnings
from collections.abc import Mapping
from typing import Any, Literal

from .exceptions import RiskModelsValidationError, RiskModelsValidationIssue, ValidationWarning

ValidateMode = Literal["off", "warn", "error"]

L3_ER_FIELDS = ("l3_market_er", "l3_sector_er", "l3_subsector_er", "l3_residual_er")


def validate_l3_er_sum(
    metrics: Mapping[str, Any],
    *,
    tolerance: float = 0.05,
) -> tuple[bool, float | None, RiskModelsValidationIssue | None]:
    values = [metrics.get(f) for f in L3_ER_FIELDS]
    if any(v is None for v in values):
        # Partial snapshot: do not warn — common when modelling is incomplete.
        return True, None, None
    total = sum(float(v) for v in values)  # type: ignore[arg-type]
    # Small epsilon so IEEE754 sums on the tolerance boundary (e.g. 0.95 vs 1.0) still pass.
    ok = abs(total - 1.0) <= tolerance + 1e-12
    if ok:
        return True, total, None
    issue = RiskModelsValidationIssue(
        code="l3_er_sum",
        severity="warn",
        message=f"L3 explained-risk components sum to {total:.4f}, expected 1.0 ± {tolerance}.",
        fix="Treat as a data-quality flag; verify model version and as-of date match your research slice.",
    )
    return False, total, issue


def validate_hr_signs(_metrics: Mapping[str, Any]) -> list[RiskModelsValidationIssue]:
    """HR sign checks were removed; hedge ratios may be negative at any level."""
    return []


def run_validation(
    metrics: Mapping[str, Any],
    *,
    mode: ValidateMode = "warn",
    er_tolerance: float = 0.05,
) -> list[RiskModelsValidationIssue]:
    """Run L3 ER sum checks; emit warnings or raise per mode. Returns collected issues."""
    if mode == "off":
        return []
    issues: list[RiskModelsValidationIssue] = []
    ok, _total, er_issue = validate_l3_er_sum(metrics, tolerance=er_tolerance)
    if er_issue and not ok:
        issues.append(er_issue)

    for issue in issues:
        if issue.severity == "error" or mode == "error":
            raise RiskModelsValidationError(issue.message, fix=issue.fix, issue=issue)
        if mode == "warn":
            warnings.warn(
                ValidationWarning(issue.message, fix=issue.fix, issue=issue),
                stacklevel=3,
            )
    return issues
