"""API and validation exceptions with LLM-oriented copy."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


class APIError(Exception):
    """HTTP or API contract error."""

    def __init__(self, message: str, *, status_code: int | None = None, body: Any = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.body = body


class AuthError(APIError):
    """Authentication failure."""


@dataclass
class RiskModelsValidationIssue:
    code: str
    severity: str  # "warn" | "error"
    message: str
    fix: str


class ValidationWarning(UserWarning):
    """ERM3 validation issue (warning mode)."""

    def __init__(self, message: str, *, fix: str = "", issue: RiskModelsValidationIssue | None = None):
        self.fix = fix
        self.issue = issue
        super().__init__(message)

    def __str__(self) -> str:
        base = super().__str__()
        if self.fix:
            return f"Warning: {base} Fix: {self.fix}"
        return base


class RiskModelsValidationError(Exception):
    """ERM3 validation failed (strict / error mode)."""

    def __init__(self, message: str, *, fix: str = "", issue: RiskModelsValidationIssue | None = None):
        self.fix = fix
        self.issue = issue
        super().__init__(message)

    def __str__(self) -> str:
        base = super().__str__()
        if self.fix:
            return f"Error: {base} Fix: {self.fix}"
        return base
