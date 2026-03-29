"""Pytest hooks — keep ``RiskModelsClient.from_env()`` tests isolated from repo ``.env.local``."""

from __future__ import annotations

from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def _disable_dotenv_during_tests(request: pytest.FixtureRequest) -> None:
    """Workspace ``.env.local`` must not override monkeypatched credentials in unit tests."""
    if request.path.name == "test_env.py":
        yield
        return
    with patch("riskmodels.env.load_repo_dotenv", return_value=False):
        yield
