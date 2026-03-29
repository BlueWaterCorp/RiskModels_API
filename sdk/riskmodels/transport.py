"""HTTP transport with optional OAuth retry on 401."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import httpx

from .auth import OAuthClientCredentialsAuth
from .exceptions import APIError, AuthError
from .lineage import RiskLineage


class Transport:
    def __init__(
        self,
        base_url: str,
        auth: Any,
        *,
        timeout: float = 120.0,
        http_client: httpx.Client | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._auth = auth
        self._timeout = timeout
        self._client = http_client or httpx.Client(timeout=timeout, follow_redirects=True)

    def close(self) -> None:
        self._client.close()

    def request(
        self,
        method: str,
        path: str,
        *,
        params: Mapping[str, Any] | None = None,
        json: Any = None,
        content: bytes | None = None,
        headers: Mapping[str, str] | None = None,
        expect_json: bool = True,
    ) -> tuple[Any, RiskLineage, httpx.Response]:
        """Return (parsed_body_or_bytes, lineage, response)."""
        url = f"{self._base_url}{path}" if path.startswith("/") else f"{self._base_url}/{path}"
        hdrs: dict[str, str] = dict(self._auth.authorization_header())
        if headers:
            hdrs.update(headers)
        attempt = 0
        while True:
            attempt += 1
            r = self._client.request(
                method,
                url,
                params=params,
                json=json,
                content=content,
                headers=hdrs,
            )
            if r.status_code == 401 and attempt == 1 and isinstance(self._auth, OAuthClientCredentialsAuth):
                self._auth.invalidate()
                hdrs = dict(self._auth.authorization_header())
                if headers:
                    hdrs.update(headers)
                continue
            lineage = RiskLineage.from_response_headers(r.headers)
            if r.status_code >= 400:
                body: Any
                try:
                    body = r.json()
                except Exception:
                    body = r.text
                if isinstance(body, dict):
                    msg = (
                        body.get("message")
                        or body.get("error")
                        or (body.get("detail") if isinstance(body.get("detail"), str) else None)
                        or str(body)
                    )
                else:
                    msg = str(body) if body else ""
                text_fallback = (r.text or "").strip()
                if not (msg and str(msg).strip()):
                    msg = text_fallback[:2000] if text_fallback else f"HTTP {r.status_code} (empty error body)"
                exc: type[APIError] = AuthError if r.status_code == 401 else APIError
                raise exc(str(msg), status_code=r.status_code, body=body)
            if expect_json:
                if not r.content:
                    return None, lineage, r
                return r.json(), lineage, r
            return r.content, lineage, r
