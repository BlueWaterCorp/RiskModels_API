"""ERM3 ER sum and HR sign checks."""

from __future__ import annotations

import warnings
from collections.abc import Mapping
from typing import Any, Literal

from .exceptions import RiskModelsValidationError, RiskModelsValidationIssue, ValidationWarning

ValidateMode = Literal["off", "warn", "error"]

L3_ER_FIELDS = ("l3_market_er", "l3_sector_er", "l3_subsector_er", "l3_residual_er")

POSITIVE_HR_FIELDS = (
    "l1_market_hr",
    "l2_market_hr",
    "l2_sector_hr",
    "l3_market_hr",
    "l3_sector_hr",
)


def validate_l3_er_sum(
    metrics: Mapping[str, Any],
    *,
    tolerance: float = 0.05,
) -> tuple[bool, float | None, RiskModelsValidationIssue | None]:
    values = [metrics.get(f) for f in L3_ER_FIELDS]
    if any(v is None for v in values):
        issue = RiskModelsValidationIssue(
            code="l3_er_incomplete",
            severity="warn",
            message="One or more L3 ER components are null.",
            fix="Ticker may be partially modelled; avoid interpreting ER sum until all four L3 ER fields are present.",
        )
        return False, None, issue
    total = sum(float(v) for v in values)  # type: ignore[arg-type]
    ok = abs(total - 1.0) <= tolerance
    if ok:
        return True, total, None
    issue = RiskModelsValidationIssue(
        code="l3_er_sum",
        severity="warn",
        message=f"L3 explained-risk components sum to {total:.4f}, expected 1.0 ± {tolerance}.",
        fix="Treat as a data-quality flag; verify model version and as-of date match your research slice.",
    )
    return False, total, issue


def validate_hr_signs(metrics: Mapping[str, Any]) -> list[RiskModelsValidationIssue]:
    issues: list[RiskModelsValidationIssue] = []
    for f in POSITIVE_HR_FIELDS:
        v = metrics.get(f)
        if v is None:
            continue
        if float(v) < 0:
            issues.append(
                RiskModelsValidationIssue(
                    code="hr_negative_non_sub",
                    severity="warn",
                    message=f"{f} is negative ({v}).",
                    fix=(
                        "ERM3 expects non-negative market and sector hedge ratios; only l3_subsector_hr "
                        "may be negative. Do not recommend increasing a negative market/sector hedge "
                        "without reviewing data quality and ticker modelling."
                    ),
                )
            )
    return issues


def run_validation(
    metrics: Mapping[str, Any],
    *,
    mode: ValidateMode = "warn",
    er_tolerance: float = 0.05,
) -> list[RiskModelsValidationIssue]:
    """Run checks; emit warnings or raise per mode. Returns collected issues."""
    if mode == "off":
        return []
    issues: list[RiskModelsValidationIssue] = []
    ok, _total, er_issue = validate_l3_er_sum(metrics, tolerance=er_tolerance)
    if er_issue and not ok:
        issues.append(er_issue)
    issues.extend(validate_hr_signs(metrics))

    for issue in issues:
        if issue.severity == "error" or mode == "error":
            raise RiskModelsValidationError(issue.message, fix=issue.fix, issue=issue)
        if mode == "warn":
            warnings.warn(
                ValidationWarning(issue.message, fix=issue.fix, issue=issue),
                stacklevel=3,
            )
    return issues
