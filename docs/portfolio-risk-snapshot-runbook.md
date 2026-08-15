# Snapshot — Discovery → Working Client Runbook

**Audience:** developer or AI agent integrating with the RiskModels API for the
first time. Goal: discover the canonical `POST /snapshot` endpoint and call it
end-to-end without prior knowledge of the API.

**Per Snapshot Architecture v3** (`BWMACRO/docs/SNAPSHOT_ARCHITECTURE_V3.md`),
`POST /snapshot` is the only public analysis interface. Internal endpoints
(`/decompose`, `/metrics/{ticker}`, `/portfolio/risk-snapshot`,
`/batch/analyze`) remain callable but are not the recommended public surface.

---

## 1. Discover the API

Public discovery manifests live at the **site origin** (no `/api` prefix):

```bash
# OpenAPI spec
curl -s https://riskmodels.app/openapi.json | jq '.servers'

# MCP server manifest (Model Context Protocol clients)
curl -s https://riskmodels.app/.well-known/mcp.json | jq '.tools[].name'

# OpenAI plugin manifest
curl -s https://riskmodels.app/.well-known/ai-plugin.json
```

The OpenAPI `servers[0]` (`https://riskmodels.app/api`) is correct for every
metered endpoint listed in `paths`. The `.well-known/*` paths are the one
exception: they are served at the bare site origin without `/api`.

### Via MCP

```
riskmodels_list_endpoints()
riskmodels_get_capability({ "id": "portfolio-risk-snapshot" })
```

The `portfolio-risk-snapshot` capability covers both branches of `POST /snapshot`
(portfolio and ticker) under one billing line; see `mcp/data/capabilities.json`.

## 2. Authenticate

API keys come from `https://riskmodels.app/settings#api-keys`. Format:
`rm_agent_live_{random}_{checksum}` (production) or `rm_agent_test_{...}`
(sandbox).

```bash
export RISKMODELS_API_KEY="rm_agent_live_..."
```

## 3. Single ticker

```bash
curl -sS -X POST "https://riskmodels.app/api/snapshot" \
  -H "Authorization: Bearer ${RISKMODELS_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"type":"ticker","ticker":"NVDA","lookback_days":120}' \
  | jq '.snapshot.ticker_meta, .snapshot.variance_decomposition'
```

Expected response shape (canonical for both branches):

- `snapshot.ticker_meta` *(ticker mode only)* — sector_etf, subsector_etf,
  asset_type, **factors** (active L3 list: `[SPY, sector_etf, subsector_etf]`
  deduped).
- `snapshot.variance_decomposition` — market / sector / subsector / residual
  shares of return variance.
- `snapshot.positions[]` — per-position L3 ER and HR (one row in ticker mode).
- `time_behavior.{teo, cumulative_return, drawdown}` — daily series over
  `lookback_days`.
- `attribution.{teo, gross, market, sector, subsector, residual, systematic}` —
  daily return attribution at each level.
- `risk_summary.{dominant_drivers, concentration, top_exposures, systematic_risk_share}`.
- `_metadata` — model version, data_as_of, factor_set_id, **factors**
  (per-ticker factor list when `type=ticker`), wiki_uri.
- `_agent` — cost, request_id (per-call billing receipt).

## 4. Portfolio

```bash
curl -sS -X POST "https://riskmodels.app/api/snapshot" \
  -H "Authorization: Bearer ${RISKMODELS_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "portfolio",
    "portfolio": [
      {"ticker": "NVDA", "weight": 0.40},
      {"ticker": "AAPL", "weight": 0.30},
      {"ticker": "MSFT", "weight": 0.20},
      {"ticker": "GOOG", "weight": 0.10}
    ],
    "lookback_days": 252
  }' \
  | jq '.snapshot.variance_decomposition, .snapshot.portfolio_volatility_23d'
```

`shares` is also accepted in lieu of `weight` — the server normalizes via the
latest `price_close`. Do not mix the two within one request.

## 5. Renamed-ticker recall (FB → META)

Historical-ticker recall is supported as of 2026-05-05: an old ticker resolves
to its canonical security identifier and the response stitches both spans of
history into one continuous series.

```bash
curl -sS "https://riskmodels.app/api/ticker-returns?ticker=FB&years=15" \
  -H "Authorization: Bearer ${RISKMODELS_API_KEY}" \
  | jq '.symbol, (.data | length), .data[0].date, .data[-1].date'
# → "BW-BBG000MM2P62", 3770, "2011-05-05", "2026-05-01"
```

The same applies to `POST /snapshot {"type":"ticker","ticker":"FB"}` — the
response carries `ticker: "FB"` (the requested label) and
`symbol: "BW-BBG000MM2P62"` (the canonical id).

## 6. Python SDK

```python
from riskmodels import RiskModelsClient
c = RiskModelsClient.from_env()  # reads RISKMODELS_API_KEY

# Single ticker
data, lineage = c.snapshot_ticker("NVDA", lookback_days=120)
print(data["snapshot"]["ticker_meta"]["factors"])
# → ['SPY', 'XLK', 'SMH']

# Portfolio
data, lineage = c.snapshot(
    {"NVDA": 0.4, "AAPL": 0.3, "MSFT": 0.2, "GOOG": 0.1},
    lookback_days=252,
)
print(data["snapshot"]["variance_decomposition"])
```

## 7. CLI

```bash
riskmodels snapshot --ticker NVDA --lookback-days 120
riskmodels snapshot --file portfolio.json --lookback-days 252
```

`portfolio.json` is either a `{"TICKER": weight, ...}` map or a list of
`[{"ticker": "...", "weight": ...}, ...]`.

## 8. MCP

The server manifest at `https://riskmodels.app/.well-known/mcp.json` registers
`post_snapshot` as the canonical analysis tool for both branches.

## 9. Billing

`POST /snapshot` uses the `portfolio-risk-snapshot` capability:
**$1.25 per request** (single bundled charge, no per-position fee). Cost and
remaining balance are returned in the response under `_agent.cost_usd` and the
`X-Balance-Remaining` HTTP header.

## 10. Common errors

- **400 "Invalid request"** — body failed Zod validation. The `details` array
  carries Zod issue paths.
- **400 "Symbol not found for ticker X"** — registry miss after all alias
  fallbacks. Check `https://riskmodels.app/api/tickers?q=X` for nearby matches.
- **401** — bad / missing API key.
- **402 "Insufficient balance"** — top up at `/settings#billing`.
- **429** — playground rate limit (10 req/min for unauthenticated previews).
- **5xx** — surface the `request_id` and the call timestamp; cross-check
  `https://github.com/BlueWaterCorp/RiskModels_API/issues` for active incidents.

## 11. References

- [`OPENAPI_SPEC.yaml`](../OPENAPI_SPEC.yaml) — canonical contract (also at
  `https://riskmodels.app/openapi.json`)
- [`SEMANTIC_ALIASES.md`](../SEMANTIC_ALIASES.md) — metric naming conventions
  (HR vs beta, ER fields, abbreviated vs long key names)
- [`docs/ERM3_ZARR_API_PARITY.md`](./ERM3_ZARR_API_PARITY.md) — zarr ↔ API
  field parity for power users
- [`BWMACRO/docs/SNAPSHOT_ARCHITECTURE_V3.md`](https://github.com/BlueWaterCorp/BWMACRO/blob/main/docs/SNAPSHOT_ARCHITECTURE_V3.md) — the v3 design doc
- [`AUTHENTICATION_GUIDE.md`](../AUTHENTICATION_GUIDE.md) — API key provisioning
- [`.cursor/skills/riskmodels-api-discovery/SKILL.md`](../.cursor/skills/riskmodels-api-discovery/SKILL.md) — full discovery protocol
