"""Smoke tests for :mod:`riskmodels.notebook` quickstart helpers."""

from __future__ import annotations

import pytest

from riskmodels.notebook import GET_KEY_URL, quickstart_api_base_url


def test_get_key_url() -> None:
    assert GET_KEY_URL.startswith("https://")


def test_quickstart_api_base_url_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("RISKMODELS_QUICKSTART_BASE_URL", raising=False)
    monkeypatch.delenv("RISKMODELS_API_BASE_URL", raising=False)
    assert quickstart_api_base_url() == "https://riskmodels.app/api"


def test_quickstart_api_base_url_strip_api_suffix(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RISKMODELS_API_BASE_URL", "https://example.com/api")
    assert quickstart_api_base_url() == "https://example.com/api"


def test_ensure_api_key_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    from riskmodels import notebook as nb

    monkeypatch.setenv("RISKMODELS_API_KEY", "rm_test_fake_key_0000000000")
    monkeypatch.setattr(nb, "load_notebook_dotenv", lambda: None)
    assert nb.ensure_riskmodels_api_key() == "rm_test_fake_key_0000000000"
