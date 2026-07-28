"""Tests for StaticBearerAuth and RiskModelsClient.from_env().

The OAuth client-credentials tests that used to live here were deleted in 0.4.0.
They mocked ``POST {base}/auth/token`` and asserted the SDK called it — but that
endpoint returns 404 in production and was never implemented, so the suite was
encoding the bug as the expectation and passing while the feature was broken for
every real user. The tests below assert the opposite: that supplying OAuth
credentials fails fast with an actionable message instead of constructing a
client that dies on its first request.
"""

from __future__ import annotations

import pytest

from riskmodels.auth import StaticBearerAuth
from riskmodels.client import RiskModelsClient


def test_static_bearer_authorization_header_format():
    auth = StaticBearerAuth("secret-token")
    assert auth.authorization_header() == {"Authorization": "Bearer secret-token"}


def test_oauth_client_credentials_class_is_gone():
    """The removed symbol must not come back without a conscious decision."""
    import riskmodels.auth as auth_mod

    assert not hasattr(auth_mod, "OAuthClientCredentialsAuth")


# --- constructor ---------------------------------------------------------


def test_ctor_api_key_builds_static_auth():
    client = RiskModelsClient(api_key="rm_agent_live_abc")
    try:
        assert isinstance(client._transport._auth, StaticBearerAuth)
    finally:
        client.close()


def test_ctor_client_credentials_raises_with_guidance():
    with pytest.raises(ValueError, match="client_credentials"):
        RiskModelsClient(client_id="cid", client_secret="csec")


def test_ctor_partial_client_credentials_also_raises():
    with pytest.raises(ValueError, match="client_credentials"):
        RiskModelsClient(client_id="cid")


def test_ctor_no_credentials_raises():
    with pytest.raises(ValueError, match="api_key"):
        RiskModelsClient()


# --- from_env ------------------------------------------------------------


def test_from_env_strips_api_key_whitespace(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("RISKMODELS_CLIENT_ID", raising=False)
    monkeypatch.delenv("RISKMODELS_CLIENT_SECRET", raising=False)
    monkeypatch.delenv("RISKMODELS_BASE_URL", raising=False)
    monkeypatch.setenv("RISKMODELS_API_KEY", "  env-key  \n")

    client = RiskModelsClient.from_env()
    try:
        assert client._transport._auth._token == "env-key"
    finally:
        client.close()


def test_from_env_api_key(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("RISKMODELS_CLIENT_ID", raising=False)
    monkeypatch.delenv("RISKMODELS_CLIENT_SECRET", raising=False)
    monkeypatch.delenv("RISKMODELS_BASE_URL", raising=False)
    monkeypatch.setenv("RISKMODELS_API_KEY", "env-key")

    client = RiskModelsClient.from_env()
    try:
        assert isinstance(client._transport._auth, StaticBearerAuth)
        assert client._transport._auth.authorization_header() == {"Authorization": "Bearer env-key"}
    finally:
        client.close()


def test_from_env_custom_base_url(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("RISKMODELS_CLIENT_ID", raising=False)
    monkeypatch.delenv("RISKMODELS_CLIENT_SECRET", raising=False)
    monkeypatch.setenv("RISKMODELS_API_KEY", "env-key")
    monkeypatch.setenv("RISKMODELS_BASE_URL", "https://other.example/api")

    client = RiskModelsClient.from_env()
    try:
        assert client._transport._base_url == "https://other.example/api"
    finally:
        client.close()


def test_from_env_oauth_env_raises_instead_of_building_broken_client(
    monkeypatch: pytest.MonkeyPatch,
):
    """Previously this returned a client whose every request 404'd."""
    monkeypatch.delenv("RISKMODELS_API_KEY", raising=False)
    monkeypatch.delenv("RISKMODELS_BASE_URL", raising=False)
    monkeypatch.setenv("RISKMODELS_CLIENT_ID", "id1")
    monkeypatch.setenv("RISKMODELS_CLIENT_SECRET", "sec1")

    with pytest.raises(ValueError, match="client_credentials"):
        RiskModelsClient.from_env()


def test_from_env_missing_credentials_raises(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("RISKMODELS_API_KEY", raising=False)
    monkeypatch.delenv("RISKMODELS_CLIENT_ID", raising=False)
    monkeypatch.delenv("RISKMODELS_CLIENT_SECRET", raising=False)

    with pytest.raises(ValueError, match="RISKMODELS_API_KEY"):
        RiskModelsClient.from_env()


def test_from_env_partial_oauth_raises(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("RISKMODELS_API_KEY", raising=False)
    monkeypatch.setenv("RISKMODELS_CLIENT_ID", "only-id")
    monkeypatch.delenv("RISKMODELS_CLIENT_SECRET", raising=False)

    with pytest.raises(ValueError, match="client_credentials"):
        RiskModelsClient.from_env()


def test_from_env_api_key_takes_precedence_over_oauth_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("RISKMODELS_API_KEY", "key-wins")
    monkeypatch.setenv("RISKMODELS_CLIENT_ID", "id1")
    monkeypatch.setenv("RISKMODELS_CLIENT_SECRET", "sec1")

    client = RiskModelsClient.from_env()
    try:
        assert isinstance(client._transport._auth, StaticBearerAuth)
        assert client._transport._auth._token == "key-wins"
    finally:
        client.close()
