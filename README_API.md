# RiskModels API Documentation

[![Live Docs](https://img.shields.io/badge/Live%20Docs-riskmodels.net%2Fdocs%2Fapi-6366f1)](https://riskmodels.net/docs/api/erm3)
[![OpenAPI](https://img.shields.io/badge/OpenAPI-3.0.3-85ea2d)](OPENAPI_SPEC.yaml)

This repository is the **authoritative public API reference** for the [RiskModels](https://riskmodels.net) equity risk model API.

- **Live interactive docs:** [riskmodels.net/docs/api/erm3](https://riskmodels.net/docs/api/erm3)
- **Issues & feature requests:** [Open an issue](https://github.com/Cerebellum-Archive/RiskModels_API/issues)

---

## Overview

The RiskModels API provides institutional-grade equity risk analysis for AI agents and quantitative applications:

- **Daily factor decompositions** — market, sector, and subsector explained-risk fractions for ~3,000 US equities
- **Hedge ratios** — dollar-denominated ETF hedge amounts at three precision levels (L1 market-only, L2 market+sector, L3 full three-ETF)
- **Historical time series** — daily returns and rolling hedge ratios going back to 2006
- **AI-agent ready** — machine-readable manifest at `/.well-known/agent-manifest`, per-request billing via prepaid balance

**Data coverage:** Universe `uni_mc_3000` (~3,000 top US stocks), date range 2006-01-04 to present, updated daily.

---

## Quick Start

### TypeScript (Browser / Node.js)

```typescript
const resp = await fetch("https://riskmodels.net/api/metrics/NVDA", {
  headers: { Authorization: "Bearer rm_agent_live_..." },
});
const m = await resp.json();

// L3 hedge: short this much SPY + sector ETF per $1 of NVDA
console.log("SPY hedge:    ", m.l3_market_hr);    // e.g. 1.28
console.log("Sector hedge: ", m.l3_sector_hr);    // e.g. 0.24
console.log("Residual risk:", m.l3_residual_er);  // e.g. 0.54 (54% idiosyncratic)
```

### Python (Jupyter / Backend)

```python
import requests

API_KEY  = "rm_agent_live_..."
HEADERS  = {"Authorization": f"Bearer {API_KEY}"}

# Get latest metrics for NVDA
m = requests.get("https://riskmodels.net/api/metrics/NVDA", headers=HEADERS).json()
print(f"Residual Risk:  {m['l3_residual_er']:.1%}")   # 54.0%
print(f"Market Hedge:   {m['l3_market_hr']:.2f}")     # 1.28 (short $1.28 SPY per $1 NVDA)
print(f"Volatility:     {m['volatility']:.1%}")       # 48.0% annualised
```

### cURL

```bash
curl -X GET "https://riskmodels.net/api/metrics/NVDA" \
  -H "Authorization: Bearer rm_agent_live_..."
```

---

## Core Endpoints

| Endpoint | Method | Description | Cost |
|---|---|---|---|
| `/api/ticker-returns` | GET | Daily returns + rolling L1/L2/L3 hedge ratios, up to 15y | $0.005/call |
| `/api/metrics/{ticker}` | GET | Latest snapshot: all 22 HR/ER fields, vol, Sharpe, sector, market cap | $0.005/call |
| `/api/l3-decomposition` | GET | Monthly historical HR/ER time series | $0.005/call |
| `/api/batch/analyze` | POST | Multi-ticker batch up to 100, 25% cheaper per position | $0.002/position |
| `/api/tickers` | GET | Ticker universe search, MAG7 shortcut | Free |
| `/api/balance` | GET | Account balance and rate limits | Free |
| `/api/invoices` | GET | Invoice history and spend summary | Free |
| `/api/health` | GET | Service health | Free |
| `/.well-known/agent-manifest` | GET | AI agent discovery manifest | Free |

Pricing model: prepaid balance (Stripe). Cached responses are free. Minimum top-up: $10.

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
| [RESPONSE_METADATA.md](RESPONSE_METADATA.md) | `_agent` block schema, response headers, pricing table, cache behaviour |
| [ERROR_SCHEMA.md](ERROR_SCHEMA.md) | All error codes, HTTP statuses, and recovery patterns |
| [VALIDATION_HELPERS.md](VALIDATION_HELPERS.md) | Python + TypeScript data quality checks |

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

Get your key at [riskmodels.net/settings](https://riskmodels.net/settings) → API Keys, or provision programmatically via `POST /api/auth/provision`. See [AUTHENTICATION_GUIDE.md](AUTHENTICATION_GUIDE.md) for full details including the AI agent provisioning flow.

---

## Support

- **Issues & feature requests:** [github.com/Cerebellum-Archive/RiskModels_API/issues](https://github.com/Cerebellum-Archive/RiskModels_API/issues)
- **API support email:** [contact@riskmodels.net](mailto:contact@riskmodels.net)
- **Interactive docs:** [riskmodels.net/docs/api/erm3](https://riskmodels.net/docs/api/erm3)
- **Status:** [riskmodels.net/status](https://riskmodels.net/status)
