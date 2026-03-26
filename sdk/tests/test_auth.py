"""Tests for StaticBearerAuth, OAuthClientCredentialsAuth, and RiskModelsClient.from_env()."""

from __future__ import annotations

import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from unittest.mock import patch

import httpx
import pytest

from riskmodels.auth import OAuthClientCredentialsAuth, StaticBearerAuth
from riskmodels.client import RiskModelsClient

# Patch target is `riskmodels.auth.httpx.Client`, which aliases the same `httpx`
# module — patching replaces `httpx.Client` globally until unpatch. Keep the real
# class to build clients inside the mock side_effect.
_RealHttpxClient = httpx.Client

API_BASE = "https://rm.test/api"


def _client_factory_for_transport(transport: httpx.MockTransport):
    """OAuth uses httpx.Client inside auth.py; inject our mock transport."""

    def _factory(*args, **kwargs):
        timeout = kwargs.get("timeout", 60.0)
        return _RealHttpxClient(transport=transport, timeout=timeout)

    return _factory


def test_static_bearer_authorization_header_format():
    auth = StaticBearerAuth("secret-token")
    assert auth.authorization_header() == {"Authorization": "Bearer secret-token"}


def test_oauth_posts_expected_json_and_caches_token():
    posts: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        posts.append(request)
        assert request.method == "POST"
        assert str(request.url) == f"{API_BASE}/auth/token"
        body = json.loads(request.content.decode())
        assert body == {
            "grant_type": "client_credentials",
            "client_id": "cid",
            "client_secret": "csec",
            "scope": "s1 s2",
        }
        return httpx.Response(200, json={"access_token": "tok-a", "expires_in": 900})

    transport = httpx.MockTransport(handler)
    factory = _client_factory_for_transport(transport)

    with patch("riskmodels.auth.httpx.Client", side_effect=factory):
        auth = OAuthClientCredentialsAuth(
            API_BASE,
            "cid",
            "csec",
            "s1 s2",
            skew_seconds=60,
        )
        assert auth.authorization_header() == {"Authorization": "Bearer tok-a"}
        assert auth.authorization_header() == {"Authorization": "Bearer tok-a"}

    assert len(posts) == 1


def test_oauth_refetches_after_monotonic_past_expiry_minus_skew():
    posts: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        posts.append(request)
        n = len(posts)
        return httpx.Response(200, json={"access_token": f"tok-{n}", "expires_in": 900})

    transport = httpx.MockTransport(handler)
    factory = _client_factory_for_transport(transport)

    # First fetch: now=0, expires_at=0+900=900. Cached while now < 900-60=840.
    mono = iter([0.0, 0.0, 10.0, 850.0, 850.0])

    def monotonic_side_effect() -> float:
        return next(mono)

    with patch("riskmodels.auth.httpx.Client", side_effect=factory), patch(
        "riskmodels.auth.time.monotonic", side_effect=monotonic_side_effect
    ):
        auth = OAuthClientCredentialsAuth(API_BASE, "cid", "csec", "scope", skew_seconds=60)
        assert auth.authorization_header()["Authorization"] == "Bearer tok-1"
        assert auth.authorization_header()["Authorization"] == "Bearer tok-1"
        assert auth.authorization_header()["Authorization"] == "Bearer tok-2"

    assert len(posts) == 2


def test_oauth_invalidate_forces_refetch():
    posts: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        posts.append(request)
        return httpx.Response(200, json={"access_token": f"t{len(posts)}", "expires_in": 900})

    transport = httpx.MockTransport(handler)
    factory = _client_factory_for_transport(transport)

    with patch("riskmodels.auth.httpx.Client", side_effect=factory), patch(
        "riskmodels.auth.time.monotonic", return_value=0.0
    ):
        auth = OAuthClientCredentialsAuth(API_BASE, "cid", "csec", "scope", skew_seconds=60)
        assert auth.authorization_header()["Authorization"] == "Bearer t1"
        assert auth.authorization_header()["Authorization"] == "Bearer t1"
        auth.invalidate()
        assert auth.authorization_header()["Authorization"] == "Bearer t2"

    assert len(posts) == 2


def test_oauth_concurrent_authorization_header_stable():
    posts: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        posts.append(request)
        time.sleep(0.02)
        return httpx.Response(200, json={"access_token": "shared", "expires_in": 900})

    transport = httpx.MockTransport(handler)
    factory = _client_factory_for_transport(transport)

    with patch("riskmodels.auth.httpx.Client", side_effect=factory), patch(
        "riskmodels.auth.time.monotonic", return_value=0.0
    ):
        auth = OAuthClientCredentialsAuth(API_BASE, "cid", "csec", "scope", skew_seconds=60)

        def one_header():
            return auth.authorization_header()

        with ThreadPoolExecutor(max_workers=8) as ex:
            futures = [ex.submit(one_header) for _ in range(8)]
            results = [f.result() for f in as_completed(futures)]

    assert all(r == {"Authorization": "Bearer shared"} for r in results)
    assert 1 <= len(posts) <= 8


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


def test_from_env_oauth_when_no_api_key(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("RISKMODELS_API_KEY", raising=False)
    monkeypatch.delenv("RISKMODELS_BASE_URL", raising=False)
    monkeypatch.delenv("RISKMODELS_OAUTH_SCOPE", raising=False)
    monkeypatch.setenv("RISKMODELS_CLIENT_ID", "id1")
    monkeypatch.setenv("RISKMODELS_CLIENT_SECRET", "sec1")

    client = RiskModelsClient.from_env()
    try:
        assert isinstance(client._transport._auth, OAuthClientCredentialsAuth)
    finally:
        client.close()


def test_from_env_oauth_custom_scope(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("RISKMODELS_API_KEY", raising=False)
    monkeypatch.delenv("RISKMODELS_BASE_URL", raising=False)
    monkeypatch.setenv("RISKMODELS_CLIENT_ID", "id1")
    monkeypatch.setenv("RISKMODELS_CLIENT_SECRET", "sec1")
    monkeypatch.setenv("RISKMODELS_OAUTH_SCOPE", "custom-scope")

    client = RiskModelsClient.from_env()
    try:
        oauth = client._transport._auth
        assert isinstance(oauth, OAuthClientCredentialsAuth)
        assert oauth._scope == "custom-scope"
    finally:
        client.close()


def test_from_env_custom_base_url(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("RISKMODELS_API_KEY", raising=False)
    monkeypatch.setenv("RISKMODELS_BASE_URL", "https://other.example/api")
    monkeypatch.setenv("RISKMODELS_CLIENT_ID", "id1")
    monkeypatch.setenv("RISKMODELS_CLIENT_SECRET", "sec1")

    client = RiskModelsClient.from_env()
    try:
        assert client._transport._base_url == "https://other.example/api"
    finally:
        client.close()


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

    with pytest.raises(ValueError, match="RISKMODELS_API_KEY"):
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
