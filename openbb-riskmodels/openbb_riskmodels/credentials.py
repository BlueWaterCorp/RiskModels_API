"""Resolve a RiskModels API key from OpenBB credentials, then the environment."""

from __future__ import annotations

import os
from typing import Any


def resolve_api_key(cc: Any | None = None) -> str | None:
    """Return the first non-empty RiskModels API key.

    Order: ``cc.user_settings.credentials.riskmodels_api_key`` (OpenBB
    credential store, populated because the provider declares
    ``credentials=["api_key"]``), then ``RISKMODELS_API_KEY``.
    """
    stored = _from_command_context(cc)
    if stored:
        return stored
    env = os.environ.get("RISKMODELS_API_KEY")
    if env and env.strip():
        return env.strip()
    return None


def _from_command_context(cc: Any | None) -> str | None:
    if cc is None:
        return None
    try:
        settings = getattr(cc, "user_settings", None)
        creds = getattr(settings, "credentials", None)
    except (AttributeError, TypeError):
        return None
    if creds is None:
        return None
    direct = getattr(creds, "riskmodels_api_key", None)
    if isinstance(direct, str) and direct.strip():
        return direct.strip()
    dumped: dict[str, Any]
    try:
        dumped = creds.model_dump() if hasattr(creds, "model_dump") else {}
    except (TypeError, ValueError, AttributeError):
        dumped = {}
    if not isinstance(dumped, dict):
        return None
    nested = dumped.get("riskmodels_api_key")
    if isinstance(nested, str) and nested.strip():
        return nested.strip()
    return None
