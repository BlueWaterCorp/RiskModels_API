# riskmodels-cli Testing

## 1. Fresh Install

```bash
cd cli
npm install
npm run build
npm run install:global
```

Verify `riskmodels` is now available:
```bash
which riskmodels
riskmodels --version   # should print 1.0.0
```

## 2. Pre-Config Commands (should NOT crash)

These must work before `config init` is run:

```bash
# Help text with quick start guide
riskmodels

# Version
riskmodels --version

# AI tool manifest (no credentials needed)
riskmodels manifest
riskmodels manifest --format anthropic
riskmodels manifest --format zed

# Config list (shows empty/default config)
riskmodels config list

# Balance (should give friendly error about needing API key)
riskmodels balance
```

## 3. Friendly Error on Unconfigured Commands

These should print a helpful message, not a stack trace:

```bash
riskmodels schema
# Expected: "Supabase credentials not configured. Run: riskmodels config init"

riskmodels query "SELECT 1"
# Expected: same friendly error
```

## 4. Configuration — Direct Mode

```bash
riskmodels config init
# Select "Service Role Key (direct Supabase, for development)"
# Enter your Supabase URL (must contain "supabase.co")
# Enter your Service Role Key (must start with "ey")

riskmodels config list
# Should show URL and masked key (***)
```

## 5. Configuration — Billed Mode

```bash
riskmodels config init
# Select "API Key (billed, recommended for production)"
# Enter your rm_agent_* key

# Or set directly:
riskmodels config set apiKey rm_agent_live_xxx
riskmodels config set apiBaseUrl https://riskmodels.net

riskmodels config list
# Should show truncated apiKey: rm_agent_live_xxx...
```

Config file location: `~/.config/riskmodels/config.json`

## 6. Schema Exploration (Direct Mode)

```bash
riskmodels schema
riskmodels schema --table ticker_metadata
riskmodels schema --table ticker_factor_metrics
riskmodels --json schema
```

## 7. Queries — Direct Mode

```bash
riskmodels query "SELECT * FROM ticker_metadata LIMIT 3"
riskmodels query "SELECT * FROM ticker_metadata" --limit 5
riskmodels --json query "SELECT * FROM ticker_factor_metrics LIMIT 2"
```

## 8. Queries — Billed Mode

```bash
# Set API key
riskmodels config set apiKey rm_agent_live_xxx

# Query (routes through /api/cli/query)
riskmodels query "SELECT ticker, company_name FROM ticker_metadata LIMIT 3"
# Expected: results + cost line (e.g., "Cost: $0.003")

# JSON output
riskmodels --json query "SELECT ticker FROM ticker_metadata LIMIT 1"

# Balance check
riskmodels balance
# Expected: shows current balance
```

## 9. Billed Mode — Error Handling

```bash
# With invalid API key
riskmodels config set apiKey rm_agent_live_invalid
riskmodels query "SELECT 1"
# Expected: "Invalid API key" error

# With zero balance (if applicable)
riskmodels query "SELECT 1"
# Expected: "Insufficient balance" with top-up URL
```

## 10. Security Validation

These should all be **rejected**:

```bash
riskmodels query "DELETE FROM ticker_metadata"
# Expected: "Only SELECT queries allowed"

riskmodels query "SELECT 1; DROP TABLE ticker_metadata"
# Expected: "Multiple statements not allowed"

riskmodels query "  DELETE FROM ticker_metadata"
# Expected: "Only SELECT queries allowed"

riskmodels schema --table "'; DROP TABLE ticker_metadata; --"
# Expected: "Invalid table name"
```

## 11. HTTP API (curl, for agents)

```bash
curl -X POST https://riskmodels.net/api/cli/query \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer rm_agent_live_xxx" \
  -d '{"sql": "SELECT ticker FROM ticker_metadata LIMIT 3"}'

# Check response headers:
# X-API-Cost-USD: 0.003
# X-Request-ID: <uuid>
# X-Response-Latency-Ms: <ms>
```

## 12. Website

```bash
# Start dev server
cd riskmodels_com && npm run dev

# Verify:
# - Landing page nav shows "CLI" (not "API Docs")
# - CTA button says "View CLI Docs"
# - Footer shows "CLI Docs"
# - /docs/cli renders the CLI documentation page
```

## Changes Made

| File | Change |
|------|--------|
| `auth/supabase.ts` | Lazy client init via `getSupabaseClient()` |
| `commands/query.ts` | Dual-mode (direct + billed), SQL validation, cost display |
| `commands/schema.ts` | PostgREST OpenAPI introspection, table name sanitization |
| `commands/config.ts` | Dual auth mode selection (API key vs service role) |
| `commands/balance.ts` | **New** — account balance check |
| `lib/config.ts` | Added `apiKey`, `apiBaseUrl`, `isBilledMode` |
| `lib/telemetry.ts` | Lazy client, skip in billed mode |
| `lib/display.ts` | Show results when `success + results` present |
| `index.ts` | Removed duplicate shebang, `parseAsync()`, balance command |
| `package.json` | CJS bundle output (`.cjs`) for Node compatibility |
| **Website** | |
| `capabilities.ts` | Added `cli-query` capability ($0.003/req) |
| `api/cli/query/route.ts` | **New** — billed query endpoint with `withBilling` |
| `docs/cli.md` | **New** — CLI documentation page |
| `landing-page-client.tsx` | Nav: "API Docs" → "CLI", href → `/docs/cli` |
| `docs/[...slug]/page.tsx` | Added `cli` to static params |
