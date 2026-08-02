# Authentication Guide

The RiskModels API supports four authentication modes (as of v3.0.0-agent). Choose based on your application type.

**Python SDK / public API clients:** use **Mode 1 (Bearer API key)** only — `RISKMODELS_API_KEY` with `RiskModelsClient.from_env()`. Modes 3–4 below are platform / direct-database access for internal apps, **not** part of the published `riskmodels-py` setup.

---

## Mode 1 — Bearer Token (Direct API Key)

All external API calls use a Bearer token in the `Authorization` header.

```
Authorization: Bearer rm_agent_live_<random>_<checksum>
```

**Token format:** `rm_agent_{environment}_{random}_{checksum}` or `rm_user_{random}_{checksum}`
- `environment`: `live` (production) or `test` (sandbox)
- Tokens are long-lived but can be rotated from the dashboard

### Obtaining a Token

**Option A — Dashboard:**
1. Sign up at [riskmodels.net](https://riskmodels.net)
2. Go to Settings → API Keys
3. Click "Generate Key" and copy the token

**Option A2 — Developer portal (riskmodels.app):** Keys and usage are also available at [riskmodels.app/get-key](https://riskmodels.app/get-key). After you have a key, the MCP installer is: `RISKMODELS_API_KEY=… npx -y riskmodels@latest install` (see [Quickstart](https://riskmodels.app/quickstart)).

**Option B — API provisioning endpoint (for AI agents):**
```bash
curl -X POST https://riskmodels.app/api/auth/provision \
  -H "Authorization: Bearer <session-jwt>" \
  -H "Content-Type: application/json"
```
Response:
```json
{
  "api_key": "rm_agent_live_a1b2c3d4_xyz789",
  "environment": "live",
  "created_at": "2026-02-21T10:30:00Z"
}
```

### Using the Token

```python
import requests

API_KEY  = "rm_agent_live_..."
BASE_URL = "https://riskmodels.app/api"
HEADERS  = {"Authorization": f"Bearer {API_KEY}"}

resp = requests.get(f"{BASE_URL}/metrics/NVDA", headers=HEADERS)
data = resp.json()
```

```typescript
const API_KEY  = "rm_agent_live_...";
const BASE_URL = "https://riskmodels.app/api";

const resp = await fetch(`${BASE_URL}/metrics/NVDA`, {
  headers: { Authorization: `Bearer ${API_KEY}` },
});
const data = await resp.json();
```

### Billing

Tokens use a **prepaid balance** model:
- Add credit via [riskmodels.net/settings](https://riskmodels.net/settings) (Stripe)
- Each metered request deducts from your balance
- Check balance: `GET /api/balance`
- Cached responses are **free** (`cost_usd: 0` in the `_agent` block)
- Minimum top-up: $10.00 USD

---

## Mode 2 — OAuth 2.0 Authorization Code + PKCE (MCP clients)

> **`client_credentials` is not supported.** Earlier revisions of this guide documented a
> machine-to-machine `client_credentials` grant against `POST /api/auth/token`. That
> endpoint was never implemented — it returns 404, and `/api/oauth/token` rejects the
> grant with `unsupported_grant_type`. If you are calling the REST API from a server,
> agent, or CLI, use **Mode 1 (Bearer API key)**. There is no token-exchange step.

This mode exists for **MCP clients** — Claude Desktop, Cursor, ChatGPT Developer Mode,
Grok — which self-register and sign in interactively. The authorization server advertises
itself at [`/.well-known/oauth-authorization-server`](https://riskmodels.app/.well-known/oauth-authorization-server);
that document is the source of truth for this flow.

| Property | Value |
|---|---|
| Grants | `authorization_code`, `refresh_token` |
| Authorization endpoint | `https://riskmodels.app/oauth/authorize` |
| Token endpoint | `https://riskmodels.app/api/oauth/token` |
| Registration endpoint | `https://riskmodels.app/api/oauth/register` |
| Revocation endpoint | `https://riskmodels.app/api/oauth/revoke` |
| PKCE | Required, `S256` |
| Client auth | `none` — public clients, no `client_secret` is issued |
| Scopes | `mcp:read` |
| Access token TTL | 1 hour |
| Refresh token TTL | 30 days, rotating |

Most MCP clients drive all of this for you: paste the MCP URL, click through the OAuth
sign-in, and leave client id/secret blank. The steps below are for building a client by hand.

### Step 1 — Register (RFC 7591)

```bash
curl -X POST https://riskmodels.app/api/oauth/register \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "My MCP Client",
    "redirect_uris": ["https://example.com/callback"]
  }'
```

Returns a `client_id` (UUID). `redirect_uris` must be absolute; `http://` is accepted only
for loopback hosts (RFC 8252). Limited to 30 registrations per IP per hour.

### Step 2 — Authorize

Send the user to `https://riskmodels.app/oauth/authorize` with `response_type=code`,
your `client_id`, `redirect_uri`, `scope=mcp:read`, `state`, and a PKCE
`code_challenge` (`code_challenge_method=S256`). On approval you receive a
single-use `code` at your redirect URI.

### Step 3 — Exchange the code for a token

```bash
curl -X POST https://riskmodels.app/api/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "code=$CODE" \
  -d "redirect_uri=https://example.com/callback" \
  -d "client_id=$CLIENT_ID" \
  -d "code_verifier=$CODE_VERIFIER"
```

```json
{
  "access_token": "rm_user_live_abc123_xyz789",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "5f3a...",
  "scope": "mcp:read"
}
```

The `access_token` **is** an `rm_user_*` API key. Use it exactly like a Mode 1 key —
`Authorization: Bearer rm_user_live_...` — against `/api/mcp/sse` or any REST endpoint.

### Step 4 — Refresh

```bash
curl -X POST https://riskmodels.app/api/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=refresh_token" \
  -d "refresh_token=$REFRESH_TOKEN" \
  -d "client_id=$CLIENT_ID"
```

Refresh tokens **rotate**: each use returns a new one and invalidates the old. Replaying an
already-rotated refresh token is treated as a theft signal (RFC 6819 §5.2.2.3) and revokes
every token for that user/client pair — so persist the new value on every refresh.

### Revoking

```bash
curl -X POST https://riskmodels.app/api/oauth/revoke \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "token=$TOKEN"
```

Accepts either an `rm_user_*` access token or a refresh token. Per RFC 7009 it returns 200
even for unknown tokens.

### A note on scopes

`mcp:read` is the only scope the authorization server advertises. Scope is currently
**informational**: the API records the presented scope for telemetry but authorises by key
validity and account balance, not by scope. Do not rely on scope for access control.

### Error handling

Both endpoints return RFC 6749 error bodies:

```json
{ "error": "invalid_grant", "error_description": "Authorization code already used" }
```

| Error | Meaning |
|---|---|
| `invalid_request` | Missing a required parameter |
| `invalid_grant` | Code/refresh token not found, expired, already used, or PKCE / `client_id` / `redirect_uri` mismatch |
| `unsupported_grant_type` | A grant other than `authorization_code` or `refresh_token` (e.g. `client_credentials`) |
| `invalid_redirect_uri` | Registration: `redirect_uris` missing, relative, or non-loopback `http://` |
| `too_many_requests` | 60 token requests/IP/min; 30 registrations/IP/hr |

---


## Mode 3 — Supabase JWT (Browser / Mobile Apps) — platform / direct-DB only

**Not used by the Python SDK or public REST analytics clients.** For first-party apps that query the database directly with the anon key + user auth:

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://your-project.supabase.co',
  'your-anon-key'  // Safe to expose in client-side code
);

// Sign in (passwordless magic link)
await supabase.auth.signInWithOtp({ email: 'user@example.com' });

// After sign-in, JWT is automatically attached to queries
const { data } = await supabase
  .from('security_history_latest')
  .select('symbol, returns_gross, vol_23d, l3_mkt_hr, l3_sec_hr, l3_sub_hr')
  .eq('symbol', 'BW-US67066G1040')
  .eq('periodicity', 'daily');

// Example: time-series history from security_history
const { data: history } = await supabase
  .from('security_history')
  .select('teo, metric_key, metric_value')
  .eq('symbol', 'BW-US67066G1040')
  .eq('periodicity', 'daily')
  .in('metric_key', ['returns_gross', 'l3_mkt_hr', 'l3_sec_hr', 'l3_sub_hr'])
  .gte('teo', '2024-01-01')
  .order('teo', { ascending: false })
  .limit(100);
```

Row Level Security (RLS) is enforced — users can only access data they are authorised for.

---

## Mode 4 — Service Role Key (Server-Side Internal) — platform only

**Never required for `riskmodels-py` or partner notebooks.** Internal services (e.g. Cloud Run render-svc) may use service-role access. Bypasses RLS — full database access. Do not ship these keys in client apps.

```python
# NEVER expose in browser or client-side code
supabase = create_client(
    os.getenv('SUPABASE_URL'),
    os.getenv('SUPABASE_SERVICE_ROLE_KEY')
)

response = supabase.table('security_history_latest').select('*').execute()
```

---

## Implementation — Supabase Tables (Risk_Models)

The live platform ([Risk_Models](https://github.com/BlueWaterCorp/Risk_Models)) uses Supabase for persistence. **V3 schema** (see [SUPABASE_TABLES.md](SUPABASE_TABLES.md) for full reference):

| Table | Purpose |
|-------|---------|
| `symbols` | Identity registry (symbol, ticker, name, asset_type, sector_etf) |
| `security_history` | Long-form temporal engine: (symbol, teo, periodicity, metric_key, metric_value) |
| `security_history_latest` | Latest metrics per symbol/periodicity (cards, tape, treemap) |
| `erm3_landing_chart_cache` | Landing page chart (pre-computed cumulative returns) |
| `trading_calendar` | Canonical trading dates |
| `erm3_sync_state_v3` | Sync health and freshness |
| `agent_accounts`, `agent_api_keys` | Agent keys and provisioning |
| `billing_events`, `agent_invoices`, `balance_top_ups`, `user_generated_api_keys` | Billing and prepaid balance |
| `ticker_request_logs` | Request logging / analytics (internal) |

Backend data is also served from Zarr on Google Cloud Storage (`gs://rm_api_data/`). For direct DB access use the table names above with Mode 2 or Mode 3 as appropriate.

---

## MCP Server Connection

**New in v3.0.0-agent:** RiskModels supports the [Model Context Protocol (MCP)](https://modelcontextprotocol.io) for AI agent integration.

### Connection Details

| Property | Value |
|----------|-------|
| **SSE Endpoint** | `https://riskmodels.app/api/mcp/sse` |
| **Discovery** | `https://riskmodels.app/.well-known/mcp.json` |
| **Authentication** | Bearer token (API key or OAuth2 JWT) |
| **Protocol** | Server-Sent Events (SSE) with JSON-RPC 2.0 |

### Connecting with Bearer Auth

```javascript
// Browser/SSE client
const eventSource = new EventSource('https://riskmodels.app/api/mcp/sse', {
  headers: { 'Authorization': 'Bearer rm_agent_live_...' }
});

eventSource.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('MCP message:', message);
};
```

```python
# Python SSE client
import requests

headers = {"Authorization": "Bearer rm_agent_live_..."}
response = requests.get(
    "https://riskmodels.app/api/mcp/sse",
    headers=headers,
    stream=True
)

for line in response.iter_lines():
    if line:
        print(f"Received: {line.decode('utf-8')}")
```

### Available MCP Tools

After connecting, use JSON-RPC **`tools/list`** to discover tools exposed by **that** session. Names and behavior can differ between the **hosted** MCP endpoint and the **local** stdio server in this repo’s [`mcp/`](../mcp/).

**Local `mcp/` (this repository)** exposes discovery-only tools:

| Tool | Description |
|------|-------------|
| `riskmodels_list_endpoints` | List API capabilities (id, method, endpoint, short description) |
| `riskmodels_get_capability` | Full capability record by id |
| `riskmodels_get_schema` | JSON Schema for a response path / filename |

Portfolio analysis, hedging, and L3 decomposition are **REST/SDK** concerns (e.g. `POST /api/batch/analyze`, `GET /api/l3-decomposition`, `riskmodels-py`), not implemented as separate MCP tools in `mcp/`.

### Example: Calling a Tool

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "riskmodels_get_capability",
    "arguments": {
      "id": "risk-decomposition"
    }
  },
  "id": 1
}
```

---

## AI Agent Provisioning Flow

Recommended pattern for LLM agents integrating with the RiskModels API:

1. **Discover capabilities**
   ```
   GET /.well-known/agent-manifest
   ```
   Returns service metadata, all endpoint capabilities, pricing, and the provisioning URL.

2. **Provision a token**
   ```
   POST /api/auth/provision
   ```
   Exchange a session JWT for a long-lived Bearer API key.

3. **Check balance before starting a workflow**
   ```
   GET /api/balance
   ```
   Verify `status.can_make_requests` is `true` and `balance_usd` is sufficient.

4. **Make data requests**
   ```
   Authorization: Bearer rm_agent_live_...
   ```

5. **Monitor cost per request**
   Read `_agent.cost_usd` in each response body, or the `X-API-Cost-USD` header.

6. **Top up when balance is low**

   There is no programmatic top-up endpoint — top-ups go through Stripe Checkout:
   ```
   https://riskmodels.app/get-key
   ```
   402 responses carry the same URL in `top_up_url` and the `X-Top-Up-URL` header.

---

## Rate Limits (v3.0.0-agent)

**Per-API-Key Rate Limiting:** All authenticated endpoints are rate limited on a per-API-key basis using a sliding window algorithm backed by Upstash Redis.

| Tier | Requests / Minute | Daily Limit | Burst |
|---|---|---|---|
| Default (pay-as-you-go) | 60 | Unlimited | 100 |
| Premium (`rate:300` scope) | 300 | Unlimited | 500 |
| Max concurrent | 10 | — | — |

### Rate Limit Headers

All responses include rate limit information:

```http
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 42
X-RateLimit-Reset: 1709856000
```

- `X-RateLimit-Limit` - Total requests allowed per minute
- `X-RateLimit-Remaining` - Requests remaining in current window
- `X-RateLimit-Reset` - Unix timestamp when limit resets

### 429 Too Many Requests

When rate limit is exceeded, you'll receive:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 23
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1709856023

{
  "error": "Rate limit exceeded. Try again at 2026-03-08T12:34:56Z"
}
```

**Best Practice:** Implement exponential backoff starting at the `Retry-After` value.

### Premium Rate Limits

To request premium rate limits, contact service@riskmodels.app to add the `rate:300` scope to your API key.

---

## Security Notes

- Never commit API keys to source control
- Use environment variables: `RISKMODELS_API_KEY=rm_agent_live_...`
- Rotate keys from the dashboard if compromised
- Service role key must never appear in browser-side code
- Test keys (`rm_agent_test_...`) return simulated responses and do not deduct balance

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| **3.0.0-agent** | March 8, 2026 | Added OAuth2 client credentials flow, enhanced rate limiting, scope-based access control |
| **2.0.0-agent** | February 2026 | Initial agent-ready API with Bearer token auth |

See [MIGRATION_V3.md](./MIGRATION_V3.md) for upgrade instructions.
