# Authentication Guide

The RiskModels API supports three authentication modes. Choose based on your application type.

---

## Mode 1 — Bearer Token (Recommended for External API Consumers)

All external API calls use a Bearer token in the `Authorization` header.

```
Authorization: Bearer rm_agent_live_<random>_<checksum>
```

**Token format:** `rm_agent_{environment}_{random}_{checksum}`
- `environment`: `live` (production) or `test` (sandbox)
- Tokens are long-lived but can be rotated from the dashboard

### Obtaining a Token

**Option A — Dashboard:**
1. Sign up at [riskmodels.net](https://riskmodels.net)
2. Go to Settings → API Keys
3. Click "Generate Key" and copy the token

**Option B — API provisioning endpoint (for AI agents):**
```bash
curl -X POST https://riskmodels.net/api/auth/provision \
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
BASE_URL = "https://riskmodels.net/api"
HEADERS  = {"Authorization": f"Bearer {API_KEY}"}

resp = requests.get(f"{BASE_URL}/metrics/NVDA", headers=HEADERS)
data = resp.json()
```

```typescript
const API_KEY  = "rm_agent_live_...";
const BASE_URL = "https://riskmodels.net/api";

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

## Mode 2 — Supabase JWT (Browser / Mobile Apps)

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
  .from('ticker_factor_metrics')
  .select('*')
  .eq('ticker', 'NVDA');

// Example: factor betas with level (market/sector/subsector)
const { data: betas } = await supabase
  .from('erm3_betas')
  .select('ticker, date, fact, fact_level, level_label, beta')
  .eq('ticker', 'NVDA')
  .eq('fact_level', 1)
  .order('date', { ascending: false })
  .limit(30);
```

Row Level Security (RLS) is enforced — users can only access data they are authorised for.

---

## Mode 3 — Service Role Key (Server-Side Internal)

For server-side applications with direct Supabase access. Bypasses RLS — full database access.

```python
# NEVER expose in browser or client-side code
supabase = create_client(
    os.getenv('SUPABASE_URL'),
    os.getenv('SUPABASE_SERVICE_ROLE_KEY')
)

response = supabase.table('ticker_factor_metrics').select('*').execute()
```

---

## Implementation — Supabase Tables (Risk_Models)

The live platform ([Risk_Models](https://github.com/Cerebellum-Archive/Risk_Models)) uses Supabase for persistence. Tables relevant to the public API and agent features:

| Table / view | Purpose |
|--------------|---------|
| `ticker_factor_metrics` | Latest risk metrics per ticker (HR/ER, vol, sector, etc.); RLS for paid access |
| `ticker_factor_metrics_free` | View for free-tier access (subset of metrics) |
| `ticker_metadata` | Ticker symbols, names, sector/ETF mappings |
| `erm3_ticker_returns`, `erm3_l3_decomposition`, `erm3_time_index`, `erm3_etf_returns` | Time series and decomposition data (Zarr-backed or synced) |
| `erm3_betas` | Factor betas per ticker/date/fact with `fact_level` (1/2/3) and `level_label` (l1_market, l2_sector, l3_subsector); unique on (market_factor_etf, universe, ticker, date, fact, fact_level); synced from ERM3/Zarr |
| `erm3_rankings` | Ticker rankings (e.g. risk, factor exposure) for screening and API responses |
| `agent_accounts`, `agent_api_keys` | Agent keys and provisioning |
| `billing_events`, `agent_invoices`, `balance_top_ups`, `user_generated_api_keys` | Billing and prepaid balance |
| `ticker_request_logs` | Request logging / analytics (internal) |

Backend data is also served from Zarr on Google Cloud Storage (`gs://rm_api_data/`: returns, betas, hedge weights). Supabase tables `erm3_betas` and `erm3_rankings` are populated from the same pipeline or from Zarr for low-latency API and direct DB access. This reference repo documents the HTTP API only; for direct DB access use the table names above with Mode 2 or Mode 3 as appropriate.

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

## Rate Limits

| Tier | Requests / Minute | Burst |
|---|---|---|
| Default (pay-as-you-go) | 60 | 100 |
| Premium | 300 | 500 |
| Max concurrent | 10 | — |

Rate-limit responses return HTTP 429 with a `Retry-After` header. Implement exponential backoff starting at 1 second.

---

## Security Notes

- Never commit API keys to source control
- Use environment variables: `RISKMODELS_API_KEY=rm_agent_live_...`
- Rotate keys from the dashboard if compromised
- Service role key must never appear in browser-side code
- Test keys (`rm_agent_test_...`) return simulated responses and do not deduct balance
