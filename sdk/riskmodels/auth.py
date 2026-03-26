"""Bearer token: static API key or OAuth2 client credentials."""

from __future__ import annotations

import threading
import time
from typing import TYPE_CHECKING, Any

import httpx

if TYPE_CHECKING:
    pass


class AuthProvider:
    def authorization_header(self) -> dict[str, str]:
        raise NotImplementedError


class StaticBearerAuth(AuthProvider):
    def __init__(self, token: str) -> None:
        self._token = token

    def authorization_header(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._token}"}


class OAuthClientCredentialsAuth(AuthProvider):
    def __init__(
        self,
        base_url: str,
        client_id: str,
        client_secret: str,
        scope: str,
        *,
        timeout: float = 60.0,
        skew_seconds: int = 60,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._client_id = client_id
        self._client_secret = client_secret
        self._scope = scope
        self._timeout = timeout
        self._skew = skew_seconds
        self._lock = threading.Lock()
        self._access_token: str | None = None
        self._expires_at: float = 0.0

    def invalidate(self) -> None:
        with self._lock:
            self._access_token = None
            self._expires_at = 0.0

    def authorization_header(self) -> dict[str, str]:
        with self._lock:
            now = time.monotonic()
            if self._access_token and now < self._expires_at - self._skew:
                return {"Authorization": f"Bearer {self._access_token}"}
        self._fetch_token()
        with self._lock:
            if not self._access_token:
                raise RuntimeError("OAuth token fetch did not set access_token")
            return {"Authorization": f"Bearer {self._access_token}"}

    def _fetch_token(self) -> None:
        url = f"{self._base_url}/auth/token"
        payload: dict[str, Any] = {
            "grant_type": "client_credentials",
            "client_id": self._client_id,
            "client_secret": self._client_secret,
            "scope": self._scope,
        }
        with httpx.Client(timeout=self._timeout) as client:
            r = client.post(url, json=payload)
            r.raise_for_status()
            data = r.json()
        token = data["access_token"]
        expires_in = int(data.get("expires_in", 900))
        with self._lock:
            self._access_token = token
            self._expires_at = time.monotonic() + max(30, expires_in)
