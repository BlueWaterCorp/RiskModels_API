# Migration Guide: v2.0.0 → v3.0.0-agent

**Date:** March 8, 2026  
**Status:** Production Ready

---

## Overview

Version 3.0.0-agent introduces significant enhancements to the RiskModels API, including OAuth2 authentication, Plaid integration, MCP server support, and AI marketplace compliance. This guide will help you migrate from v2.0.0 to v3.0.0-agent.

---

## Breaking Changes

### 1. Authentication Requirements

**v2.0.0 (Old):**
```bash
# Session cookies were sufficient for some endpoints
curl https://riskmodels.app/api/ticker-returns?ticker=NVDA
```

**v3.0.0-agent (New):**
```bash
# All protected endpoints now require Bearer token
curl https://riskmodels.app/api/ticker-returns?ticker=NVDA \
  -H "Authorization: Bearer rm_agent_live_..."
```

**Action Required:**
- Generate an API key at [riskmodels.net/settings](https://riskmodels.net/settings) → API Keys
- Include the Bearer token in all API requests
- Update your application to handle 401 Unauthorized responses

### 2. Rate Limiting

**v2.0.0 (Old):**
- No explicit rate limits (relied on general infrastructure limits)

**v3.0.0-agent (New):**
- **Default:** 60 requests per minute per API key
- **Premium:** 300 requests per minute (via scope: `rate:300`)
- Returns HTTP 429 when limit exceeded
- Response headers include rate limit info:
  - `X-RateLimit-Limit`: Total requests allowed per minute
  - `X-RateLimit-Remaining`: Requests remaining in current window
  - `X-RateLimit-Reset`: Unix timestamp when limit resets

**Action Required:**
- Monitor `X-RateLimit-Remaining` header
- Implement exponential backoff for 429 responses
- Request premium rate limit scope if needed

### 3. Error Response Codes

**New HTTP Status Codes:**
- `402 Payment Required` - Insufficient account balance
- `429 Too Many Requests` - Rate limit exceeded
- `403 Forbidden` - Missing required scope

**Action Required:**
- Update error handling to recognize new status codes
- Implement retry logic for 429 responses
- Handle 402 by prompting user to add funds

---

## New Features

### 1. OAuth2 Client Credentials Flow

**Use Case:** Machine-to-machine authentication for AI agents, server-to-server integrations

**Example:**
```bash
# Exchange API credentials for short-lived JWT token
curl -X POST https://riskmodels.app/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "rm_agent_live_abc123",
    "client_secret": "rm_agent_live_abc123_xyz789_checksum",
    "scope": "ticker-returns risk-decomposition"
  }'

# Response:
# {
#   "access_token": "eyJhbGc...",
#   "token_type": "Bearer",
#   "expires_in": 900,
#   "scope": "ticker-returns risk-decomposition"
# }

# Use access token in subsequent requests
curl -X GET https://riskmodels.app/api/metrics/NVDA \
  -H "Authorization: Bearer eyJhbGc..."
```

**Benefits:**
- Short-lived tokens (15 minutes) improve security
- Scoped access control
- Standard OAuth2 protocol
- Automatic token refresh in SDKs

### 2. Plaid Investments Integration

**New Endpoints:**
- `POST /api/plaid/link/token/create` - Create Plaid Link token
- `POST /api/plaid/exchange-token` - Exchange public token
- `GET /api/plaid/holdings` - Fetch enriched holdings with risk metrics
- `POST /api/plaid/webhook` - Plaid webhook handler (internal)

**Example:**
```bash
# Fetch enriched holdings from connected Plaid accounts
curl -X GET https://riskmodels.app/api/plaid/holdings \
  -H "Authorization: Bearer rm_agent_live_..."

# Response includes risk metrics for each holding
```

**Features:**
- Automatic ticker resolution and normalization
- Risk enrichment with factor exposures (L1/L2/L3)
- Real-time portfolio valuation
- Multi-account aggregation
- Webhook notifications for holdings updates

### 3. MCP Server Support

**New Endpoints:**
- `GET /api/mcp/sse` - Server-Sent Events endpoint
- `POST /api/mcp/sse` - JSON-RPC 2.0 endpoint

**Hosted MCP tools:** Discover with `tools/list` on your session (names depend on deployment).

**Local `mcp/` package (this repo)** exposes discovery tools only:
- `riskmodels_list_endpoints` - List API capabilities
- `riskmodels_get_capability` - Get detailed capability info
- `riskmodels_get_schema` - Fetch JSON schemas

Portfolio and decomposition workflows use **REST** (`/api/batch/analyze`, `/api/l3-decomposition`, etc.) or **`riskmodels-py`**, not extra MCP tools in `mcp/`.

**Use Case:** AI agents in Cursor, Claude Desktop, Zed, etc.

### 4. Compliance Manifests

**New Endpoints:**
- `GET /.well-known/ai-plugin.json` - OpenAI GPT Store manifest
- `GET /.well-known/agentic-disclosure.json` - Privacy disclosure
- `GET /.well-known/mcp.json` - MCP server manifest

**Purpose:** Enable AI marketplace integration and demonstrate privacy compliance

---

## Migration Steps

### Step 1: Update Authentication

#### Option A: Use Direct API Keys (Simplest)

```typescript
// Before (v2.0.0)
const response = await fetch('https://riskmodels.app/api/metrics/NVDA');

// After (v3.0.0-agent)
const response = await fetch('https://riskmodels.app/api/metrics/NVDA', {
  headers: {
    'Authorization': 'Bearer rm_agent_live_...'
  }
});
```

#### Option B: Use OAuth2 Flow (Recommended for AI Agents)

```typescript
// Step 1: Get OAuth2 token
async function getAccessToken(clientId: string, clientSecret: string) {
  const response = await fetch('https://riskmodels.app/api/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'ticker-returns risk-decomposition'
    })
  });
  const data = await response.json();
  return data.access_token;
}

// Step 2: Use access token (cache for 15 minutes)
const token = await getAccessToken('rm_agent_live_abc123', 'rm_agent_live_abc123_xyz789_checksum');

const response = await fetch('https://riskmodels.app/api/metrics/NVDA', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

### Step 2: Handle Rate Limits

```typescript
async function fetchWithRateLimit(url: string, options: RequestInit) {
  const response = await fetch(url, options);
  
  // Check rate limit headers
  const remaining = parseInt(response.headers.get('X-RateLimit-Remaining') || '0');
  const reset = parseInt(response.headers.get('X-RateLimit-Reset') || '0');
  
  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('Retry-After') || '60');
    console.warn(`Rate limit exceeded. Retry after ${retryAfter} seconds.`);
    
    // Wait and retry
    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
    return fetchWithRateLimit(url, options);
  }
  
  if (remaining < 10) {
    console.warn(`Rate limit low: ${remaining} requests remaining`);
  }
  
  return response;
}
```

### Step 3: Handle New Error Codes

```typescript
async function handleApiResponse(response: Response) {
  if (!response.ok) {
    const error = await response.json();
    
    switch (response.status) {
      case 401:
        throw new Error('Authentication failed. Check your API key.');
      case 402:
        throw new Error(`Insufficient balance: ${error.message}`);
      case 403:
        throw new Error(`Missing required scope: ${error.message}`);
      case 429:
        throw new Error(`Rate limit exceeded: ${error.message}`);
      default:
        throw new Error(`API error: ${error.message}`);
    }
  }
  
  return response.json();
}
```

### Step 4: Update OpenAPI Spec (If Using Codegen)

```bash
# Download the new v3.0.0-agent OpenAPI spec
curl -O https://raw.githubusercontent.com/Cerebellum-Archive/RiskModels_API/main/OPENAPI_SPEC.yaml

# Regenerate your client SDK
npx openapi-generator-cli generate \
  -i OPENAPI_SPEC.yaml \
  -g typescript-fetch \
  -o ./src/generated
```

---

## Testing Checklist

- [ ] All API calls include Bearer token
- [ ] Error handling covers 401, 402, 403, 429
- [ ] Rate limit headers are monitored
- [ ] OAuth2 token refresh implemented (if using OAuth2)
- [ ] Exponential backoff for 429 responses
- [ ] Updated to OpenAPI spec v3.0.0-agent
- [ ] Tested with insufficient balance (402)
- [ ] Tested rate limit exceeded (429)

---

## Rollback Plan

If you need to temporarily revert to v2.0.0 behavior:

1. **Keep using direct API keys** (not OAuth2)
2. **Session cookies still work** for web app routes
3. **Old endpoints remain unchanged** - only new endpoints added
4. **Rate limits can be increased** - contact contact@riskmodels.net

**Note:** v2.0.0 is deprecated and will be removed in v4.0.0 (Q3 2026).

---

## Support

- **Migration Issues:** contact@riskmodels.net
- **Documentation:** [riskmodels.net/docs](https://riskmodels.net/docs)
- **Status Page:** [riskmodels.net/status](https://riskmodels.net/status)
- **GitHub Issues:** [github.com/Cerebellum-Archive/RiskModels_API/issues](https://github.com/Cerebellum-Archive/RiskModels_API/issues)

---

## FAQ

### Q: Do I need to migrate immediately?

A: No. v2.0.0 API keys continue to work. However, new features (OAuth2, Plaid, MCP) require v3.0.0-agent.

### Q: Will my existing API keys work?

A: Yes. Existing `rm_agent_*` and `rm_user_*` keys work with both v2.0.0 and v3.0.0-agent endpoints.

### Q: How do I get premium rate limits?

A: Contact contact@riskmodels.net to add the `rate:300` scope to your API key.

### Q: Can I use OAuth2 with the CLI?

A: Yes. The CLI (`riskmodels-cli`) automatically uses OAuth2 when configured with API credentials.

### Q: What happens if I exceed my rate limit?

A: You'll receive a 429 response with a `Retry-After` header indicating when you can retry. Implement exponential backoff.

### Q: Is Plaid integration required?

A: No. Plaid integration is optional. You can continue using the API without connecting Plaid accounts.

---

**Version:** 1.0.0  
**Last Updated:** March 8, 2026  
**Next Review:** Q2 2026
