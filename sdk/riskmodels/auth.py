"""Bearer token authentication.

Only static API keys are supported. Pass ``rm_agent_*`` or ``rm_user_*`` as
``api_key`` (or set ``RISKMODELS_API_KEY``) and it goes straight into the
``Authorization`` header — there is no token-exchange step.

Removed in 0.4.0: ``OAuthClientCredentialsAuth``. It POSTed a
``client_credentials`` grant to ``{base_url}/auth/token``, an endpoint that was
documented but never implemented — it returns 404 in production, so every call
through that path raised on ``raise_for_status()``. The only OAuth flow the API
implements is authorization-code + PKCE at ``/api/oauth/token``, which exists to
let MCP clients (Claude Desktop, Cursor) sign in interactively; it issues an
``rm_user_*`` key that you then pass here as ``api_key``.
"""

from __future__ import annotations


class AuthProvider:
    def authorization_header(self) -> dict[str, str]:
        raise NotImplementedError


class StaticBearerAuth(AuthProvider):
    def __init__(self, token: str) -> None:
        self._token = token

    def authorization_header(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._token}"}
