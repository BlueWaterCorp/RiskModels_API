# RiskModels Platform

[![npm version](https://badge.fury.io/js/riskmodels-cli.svg)](https://badge.fury.io/js/riskmodels-cli)
[![Live Docs](https://img.shields.io/badge/Live%20Docs-riskmodels.net%2Fdocs%2Fcli-6366f1)](https://riskmodels.net/docs/cli)
[![Interactive API](https://img.shields.io/badge/API%20Docs-riskmodels.net%2Fdocs%2Fapi%2Ferm3-6366f1)](https://riskmodels.net/docs/api/erm3)

**Agent-ready CLI and API for equity risk models, factor metrics, and hedge ratios.**

- **CLI**: `npm install -g riskmodels-cli` - Command-line access to risk models
- **API**: `https://riskmodels.net/api` - HTTP endpoints for programmatic access
- **Interactive Docs**: [riskmodels.net/docs/cli](https://riskmodels.net/docs/cli)
- **OpenAPI Spec**: [riskmodels.net/docs/api/erm3](https://riskmodels.net/docs/api/erm3)

---

## 🚀 Quick Start (CLI - Recommended)

The RiskModels CLI is the fastest way to access risk model data from your terminal or AI agents.

### Install the CLI

```bash
npm install -g riskmodels-cli
```

### Get a Free API Key (No Payment Required)

```bash
curl -X POST https://riskmodels.net/api/auth/provision-free \
  -H "Content-Type: application/json" \
  -d '{"agent_name": "my-agent"}'

# Returns: rm_agent_free_xxxxxxxxxxxx
```

### Configure the CLI

```bash
riskmodels config set apiKey rm_agent_free_xxxxxxxxxxxx
```

### Test It Out

```bash
# Query risk metrics for AAPL
riskmodels query "SELECT ticker, l3_market_hr, volatility FROM ticker_factor_metrics WHERE ticker = 'AAPL' LIMIT 1"

# Expected output:
# ✓ Results: 1 row
# Cost: $0.00 | Tier: free | Used Today: 1/100
# {"ticker": "AAPL", "l3_market_hr": -1.49, "volatility": 0.316}
```

### Use with AI Agents

Generate a tool manifest for your AI agent:

```bash
# For Claude Desktop
riskmodels manifest --format anthropic > claude-tools.json

# For Zed Editor
riskmodels manifest --format zed > zed-tools.json

# For OpenAI GPTs
riskmodels manifest --format openai > openai-tools.json
```

**Free Tier Limits**: 100 queries/day, 10 queries/minute  
**Paid Tier**: $0.003/query, no daily limits

**Full CLI Documentation**: See [CLI_COMMAND_TESTING.md](./CLI_COMMAND_TESTING.md) for comprehensive examples.

---

## 📊 API Quick Start (Alternative)

If you prefer direct HTTP API access:

### TypeScript

```typescript
const resp = await fetch("https://riskmodels.net/api/metrics/NVDA", {
  headers: { Authorization: "Bearer rm_agent_live_..." },
});
const m = await resp.json();

console.log("SPY hedge:", m.l3_market_hr);        // e.g. 1.28
console.log("Residual risk:", m.l3_residual_er);  // e.g. 0.54 (54% idiosyncratic)
console.log("Volatility:", m.volatility);         // e.g. 0.048 (48% annualized)
```

### Python

```python
import requests

API_KEY = "rm_agent_live_..."
HEADERS = {"Authorization": f"Bearer {API_KEY}"}

# Get latest metrics for NVDA
m = requests.get("https://riskmodels.net/api/metrics/NVDA", headers=HEADERS).json()

print(f"Market Hedge:   {m['l3_market_hr']:.2f}")     # 1.28
print(f"Residual Risk:  {m['l3_residual_er']:.1%}")   # 54.0%
print(f"Volatility:     {m['volatility']:.1%}")       # 48.0%
```

### cURL

```bash
curl -X GET "https://riskmodels.net/api/metrics/NVDA" \
  -H "Authorization: Bearer rm_agent_live_..."
```

---

## 📦 Core Endpoints

| Endpoint | Method | Description | Cost |
|---|---|---|---|
| `/api/ticker-returns` | GET | Daily returns + rolling L1/L2/L3 hedge ratios, up to 15y | $0.005/call |
| `/api/metrics/{ticker}` | GET | Latest snapshot: all 22 HR/ER fields, vol, Sharpe, sector, market cap | $0.005/call |
| `/api/l3-decomposition` | GET | Monthly historical HR/ER time series | $0.01/call |
| `/api/batch/analyze` | POST | Multi-ticker batch up to 100, 25% cheaper per position | $0.002/position |
| `/api/tickers` | GET | Ticker universe search, MAG7 shortcut | $0.001/call |
| `/api/telemetry` | GET | Performance and reliability metrics by capability | $0.002/call |
| `/api/chat` | POST | AI Risk Analyst — natural language risk Q&A (GPT-4) | Per token |
| `/api/balance` | GET | Account balance and rate limits | Free |
| `/api/invoices` | GET | Invoice history and spend summary | Free |
| `/api/health` | GET | Service health | Free |
| `/.well-known/agent-manifest` | GET | AI agent discovery manifest | Free |

Pricing model: prepaid balance (Stripe). Cached responses are free. Minimum top-up: $10.

**Implementation:** The live API and agent manifest are served from the [Risk_Models](https://github.com/Cerebellum-Archive/Risk_Models) platform repo (Next.js, Supabase). Backend Supabase tables include `ticker_factor_metrics`, `erm3_ticker_returns`, `erm3_l3_decomposition`, `erm3_betas` (with `fact_level` / `level_label`), `erm3_rankings`, and billing/agent tables—see [AUTHENTICATION_GUIDE.md](AUTHENTICATION_GUIDE.md) and [SUPABASE_TABLES.md](SUPABASE_TABLES.md) for the full list and `erm3_betas` schema. That repo also includes app-only routes (auth, Stripe, Plaid, admin, user API keys, etc.) not covered in this public API reference.

---

## Key Concepts

### RR — Residual Risk

**Definition:** Unexplained variance after hedging all three factors (market, sector, subsector).

**Formula:** `RR = 1 - (l3_market_er + l3_sector_er + l3_subsector_er)`

**Use cases:**
- Screen for high RR (> 0.5) to identify alpha opportunities
- Risk budgeting: allocate capital to stocks with sufficient idiosyncratic capacity
- Portfolio construction: balance factor exposure vs. stock-specific risk

### HR — Hedge Ratio

**Definition:** Dollar amount of factor ETF to short per $1 of stock position.

**Example:** `l3_market_hr = 1.28` means short $1.28 of SPY for every $1.00 long in the stock.

**Use cases:**
- Construct market-neutral or factor-neutral portfolios
- Calculate hedge notionals: `hedge_notional = position_size_usd × hr_field`

### ER — Explained Risk

**Definition:** Fraction of stock variance explained by the factor regression (R-squared).

**Hierarchy:**
- **L1**: Market-only (SPY) — 1 hedge trade
- **L2**: Market + GICS sector ETF — 2 hedge trades
- **L3**: Market + sector + GICS subsector ETF — 3 hedge trades, maximum granularity

---

## Documentation

| Document | Description |
|---|---|
| [OPENAPI_SPEC.yaml](OPENAPI_SPEC.yaml) | Complete OpenAPI 3.0.3 contract with request/response schemas |
| [SEMANTIC_ALIASES.md](SEMANTIC_ALIASES.md) | Field definitions, units, formulas, and dataset coverage |
| [AUTHENTICATION_GUIDE.md](AUTHENTICATION_GUIDE.md) | Bearer token, Supabase JWT, AI agent provisioning flow |
| [SUPABASE_TABLES.md](SUPABASE_TABLES.md) | Supabase table reference (metrics, erm3_*, erm3_betas, erm3_rankings, billing) |
| [RESPONSE_METADATA.md](RESPONSE_METADATA.md) | `_agent` block schema, response headers, pricing table, cache behaviour |
| [ERROR_SCHEMA.md](ERROR_SCHEMA.md) | All error codes, HTTP statuses, and recovery patterns |
| [VALIDATION_HELPERS.md](VALIDATION_HELPERS.md) | Python + TypeScript data quality checks |
| [MCP (Cursor / IDE)](#mcp) | API visibility in Cursor and other MCP clients: manifest, capabilities, schemas, tools |

---

## MCP

A **RiskModels MCP server** in this repo exposes the API inside [Cursor](https://cursor.com) (and other [MCP](https://modelcontextprotocol.io) clients) so you can discover endpoints, read the agent manifest, list capabilities, and fetch response schemas without leaving the IDE.

**Resources:** `riskmodels:///manifest`, `riskmodels:///capabilities`, `riskmodels:///schemas/list`, `riskmodels:///schemas/{path}`, `riskmodels:///openapi`  
**Tools:** `riskmodels_list_endpoints`, `riskmodels_get_capability`, `riskmodels_get_schema`

### Setup

1. Clone **this repo** (RiskModels_API):
   ```bash
   git clone https://github.com/Cerebellum-Archive/RiskModels_API.git
   cd RiskModels_API
   ```
2. Install and build the MCP server:
   ```bash
   cd mcp-server && npm install && npm run build
   ```
3. Add the server to Cursor: create or edit `.cursor/mcp.json` in your project. Use the **absolute path** to the built server, for example:
   ```json
   {
     "mcpServers": {
       "riskmodels-api": {
         "command": "node",
         "args": ["/path/to/RiskModels_API/mcp-server/dist/index.js"]
       }
     }
   }
   ```
   If you open the RiskModels_API folder as your Cursor workspace, you can use a relative path: `"args": ["mcp-server/dist/index.js"]`.
4. Restart Cursor. The **riskmodels-api** server will appear under MCP.

**Optional:** Set `RISKMODELS_API_BASE=https://riskmodels.net` in your environment so the manifest resource fetches the live agent manifest from the API.

Full details: [mcp-server/README.md](mcp-server/README.md).

---

## Examples

**Python** (`examples/python/`):
- [`quickstart.py`](examples/python/quickstart.py) — Hedge a single stock: fetch and display latest hedge ratios
- [`hedge_portfolio.py`](examples/python/hedge_portfolio.py) — Hedge a portfolio: batch endpoint, weighted portfolio ratios
- [`factor_risk_table.py`](examples/python/factor_risk_table.py) — Factor risk attribution table (L3 decomposition)
- [`precision_hedge_chart.py`](examples/python/precision_hedge_chart.py) — Cumulative return chart: stock vs. hedge layers
- [`ai_risk_analyst.py`](examples/python/ai_risk_analyst.py) — GPT-4o + live factor data: AI risk Q&A

**TypeScript** (`examples/typescript/`):
- [`quickstart.ts`](examples/typescript/quickstart.ts) — Single stock hedge ratios and notional calculator
- [`hedge_portfolio.ts`](examples/typescript/hedge_portfolio.ts) — Portfolio batch analysis with notional hedge amounts

---

## Authentication

All data endpoints require:
```
Authorization: Bearer rm_agent_live_<random>_<checksum>
```

Get your key at [riskmodels.net/settings](https://riskmodels.net/settings) → API Keys, or provision via `POST /api/auth/provision`. See [AUTHENTICATION_GUIDE.md](AUTHENTICATION_GUIDE.md).

### Option 1: CLI

Then:
```bash
# Get free key
curl -X POST https://riskmodels.net/api/auth/provision-free ...

# Configure
riskmodels config set apiKey rm_agent_free_xxx

# Use
riskmodels query "SELECT * FROM ticker_metadata LIMIT 5"
```

### Option 2: Direct API Access (For applications)

```bash
# Install Python requests
pip install requests

# Or Node.js
npm install node-fetch

# Then use HTTP endpoints directly
```

---

## 💻 CLI Usage Examples

### Single ticker analysis
```bash
riskmodels query "SELECT ticker, volatility, l3_residual_er FROM ticker_factor_metrics WHERE ticker = 'NVDA' LIMIT 1"
```

### Multi-ticker comparison
```bash
riskmodels query "SELECT ticker, l3_market_hr, volatility FROM ticker_factor_metrics WHERE ticker IN ('AAPL', 'MSFT', 'NVDA')"
```

### Screen with conditions
```bash
riskmodels query "SELECT ticker, volatility FROM ticker_factor_metrics WHERE volatility < 0.03 ORDER BY volatility ASC LIMIT 10"
```

### JSON output (for scripting)
```bash
riskmodels --json query "SELECT ticker, market_cap FROM ticker_metadata WHERE market_cap > 1000000000000"
```

---

## 📁 Repository Structure

```
RiskModels_API/
├── cli/                          # CLI-related documentation
├── examples/
│   ├── python/                   # Python API examples
│   ├── typescript/               # TypeScript API examples
│   └── cli/                      # CLI usage examples
├── docs/
│   ├── CLI_COMMAND_TESTING.md    # Comprehensive CLI tests
│   ├── API_ENDPOINT_TESTING.md   # API test examples
│   └── PHASE_*.md               # Implementation phases
├── AUTHENTICATION_GUIDE.md       # Auth details
├── RESPONSE_METADATA.md          # Response formats
├── ERROR_SCHEMA.md              # Error handling
├── SEMANTIC_ALIASES.md          # Field definitions
├── VALIDATION_HELPERS.md        # Data validation
├── OPENAPI_SPEC.yaml           # OpenAPI 3.0.3 spec
└── README.md                   # This file
```

---

## 🔐 Authentication

### For CLI
```bash
riskmodels config set apiKey rm_agent_free_xxx  # or rm_agent_live_xxx
```

### For API
```bash
# In request header
curl -H "Authorization: Bearer rm_agent_free_xxx" https://riskmodels.net/api/metrics/NVDA
```

---

## 🔧 Tools & References

### CLI Documentation
- **Testing Guide**: [CLI_COMMAND_TESTING.md](./CLI_COMMAND_TESTING.md)
- **API Examples**: [API_ENDPOINT_TESTING.md](./API_ENDPOINT_TESTING.md)

### API Documentation
- **OpenAPI Spec**: [OPENAPI_SPEC.yaml](./OPENAPI_SPEC.yaml)
- **Response Format**: [RESPONSE_METADATA.md](./RESPONSE_METADATA.md)
- **Error Handling**: [ERROR_SCHEMA.md](./ERROR_SCHEMA.md)

### Implementation
- **Phase 1 Complete**: [PHASE_1_COMPLETE.md](./PHASE_1_COMPLETE.md)
- **Phase 3 Complete**: [PHASE_3_COMPLETE.md](./PHASE_3_COMPLETE.md)

---

## 💰 Pricing

| Tier | Cost | Queries | Rate Limit |
|------|------|---------|------------|
| **Free** | $0.00 | 100/day | 10/minute |
| **Paid** | $0.003/query | Unlimited | 60/minute |

**Billing**: Prepaid via Stripe. Top up at https://riskmodels.net/settings

---

## 🤝 Support

- **CLI Docs**: https://riskmodels.net/docs/cli
- **API Docs**: https://riskmodels.net/docs/api/erm3
- **Issues**: https://github.com/Cerebellum-Archive/RiskModels_API/issues
- **Email**: api-support@riskmodels.net
- **Status**: https://riskmodels.net/status

---

## 📄 License

MIT

---

**Last Updated**: February 27, 2026  
**CLI Version**: 1.0.0  
**API Version**: 1.0.0
