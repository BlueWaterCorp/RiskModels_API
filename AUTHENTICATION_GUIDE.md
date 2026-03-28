# Authentication Guide

The RiskModels API supports four authentication modes (as of v3.0.0-agent). Choose based on your application type.

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

## Mode 2 — OAuth2 Client Credentials (Recommended for AI Agents)

**New in v3.0.0-agent:** OAuth2 client credentials flow for machine-to-machine authentication.

### Overview

Exchange API credentials for a short-lived JWT access token (15 minutes). This is the recommended method for:
- AI agents and LLM applications
- Server-to-server integrations
- npm packages and CLI tools
- MCP clients

### Benefits

- **Short-lived tokens** - 15-minute expiry reduces security risk
- **Scoped access** - Request only the scopes you need
- **Standard protocol** - OAuth2 is widely supported
- **Automatic refresh** - SDKs can refresh tokens automatically

### OAuth2 Flow

#### Step 1: Exchange credentials for access token

```bash
curl -X POST https://riskmodels.app/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "rm_agent_live_abc123",
    "client_secret": "rm_agent_live_abc123_xyz789_checksum",
    "scope": "ticker-returns risk-decomposition"
  }'
```

**Request Parameters:**
- `grant_type` (required): Must be `"client_credentials"`
- `client_id` (required): Your API key prefix (e.g., `rm_agent_live_abc123`)
- `client_secret` (required): Your full API key
- `scope` (optional): Space-separated list of requested scopes

**Response:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 900,
  "scope": "ticker-returns risk-decomposition batch-analysis"
}
```

#### Step 2: Use access token in API requests

```bash
curl -X GET https://riskmodels.app/api/metrics/NVDA \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

#### Step 3: Refresh token when expired

Tokens expire after 15 minutes. Request a new token using the same OAuth2 endpoint.

### Available Scopes

| Scope | Description |
|-------|-------------|
| `ticker-returns` | Access ticker returns and historical data |
| `risk-decomposition` | Access L3 risk decomposition |
| `batch-analysis` | Perform portfolio batch analysis |
| `factor-correlation` | Correlate stocks with macro factors (VIX, Bitcoin, Gold, etc.) |
| `chat-risk-analyst` | Use AI risk analyst |
| `plaid:holdings` | Access Plaid-synced portfolio holdings |
| `*` | Full API access (all scopes) |

### Python Example

```python
import requests
from datetime import datetime, timedelta

class RiskModelsClient:
    def __init__(self, client_id: str, client_secret: str):
        self.client_id = client_id
        self.client_secret = client_secret
        self.access_token = None
        self.token_expiry = None
    
    def get_access_token(self) -> str:
        """Get cached token or request new one if expired."""
        if self.access_token and self.token_expiry > datetime.now():
            return self.access_token
        
        # Request new token
        response = requests.post(
            'https://riskmodels.app/api/auth/token',
            json={
                'grant_type': 'client_credentials',
                'client_id': self.client_id,
                'client_secret': self.client_secret,
                'scope': 'ticker-returns risk-decomposition'
            }
        )
        data = response.json()
        
        self.access_token = data['access_token']
        self.token_expiry = datetime.now() + timedelta(seconds=data['expires_in'] - 60)  # 60s buffer
        
        return self.access_token
    
    def get_metrics(self, ticker: str):
        """Fetch metrics with automatic token refresh."""
        token = self.get_access_token()
        response = requests.get(
            f'https://riskmodels.app/api/metrics/{ticker}',
            headers={'Authorization': f'Bearer {token}'}
        )
        return response.json()

# Usage
client = RiskModelsClient('rm_agent_live_abc123', 'rm_agent_live_abc123_xyz789_checksum')
metrics = client.get_metrics('NVDA')
```

### TypeScript Example

```typescript
interface OAuth2TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

class RiskModelsClient {
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid
    if (this.accessToken && this.tokenExpiry && this.tokenExpiry > new Date()) {
      return this.accessToken;
    }

    // Request new token
    const response = await fetch('https://riskmodels.app/api/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope: 'ticker-returns risk-decomposition'
      })
    });

    const data: OAuth2TokenResponse = await response.json();
    
    this.accessToken = data.access_token;
    this.tokenExpiry = new Date(Date.now() + (data.expires_in - 60) * 1000); // 60s buffer
    
    return this.accessToken;
  }

  async getMetrics(ticker: string) {
    const token = await this.getAccessToken();
    const response = await fetch(`https://riskmodels.app/api/metrics/${ticker}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return response.json();
  }
}

// Usage
const client = new RiskModelsClient('rm_agent_live_abc123', 'rm_agent_live_abc123_xyz789_checksum');
const metrics = await client.getMetrics('NVDA');
```

### Error Handling

**400 Bad Request** - Invalid grant_type or missing parameters
```json
{
  "error": "invalid_request",
  "error_description": "grant_type must be 'client_credentials'"
}
```

**401 Unauthorized** - Invalid credentials
```json
{
  "error": "invalid_client",
  "error_description": "Invalid client_id or client_secret"
}
```

### Configuration

Set token TTL via environment variable (server-side only):
```env
OAUTH_TOKEN_TTL_SECONDS=900  # 15 minutes (default)
```

---

## Mode 3 — Supabase JWT (Browser / Mobile Apps)

For applications that directly query Supabase (the underlying database), use the public anon key with user authentication.

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

## Mode 4 — Service Role Key (Server-Side Internal)

For server-side applications with direct Supabase access. Bypasses RLS — full database access.

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

The live platform ([Risk_Models](https://github.com/Cerebellum-Archive/Risk_Models)) uses Supabase for persistence. **V3 schema** (see [SUPABASE_TABLES.md](SUPABASE_TABLES.md) for full reference):

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
   ```
   POST /api/billing/top-up
   ```

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

To request premium rate limits, contact contact@riskmodels.net to add the `rate:300` scope to your API key.

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
