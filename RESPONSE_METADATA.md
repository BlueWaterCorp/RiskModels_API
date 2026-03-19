# Response Metadata Contract

All metered API endpoints append an `_agent` block to the response body and set corresponding HTTP headers. This document defines the schema and usage guidance.

---

## `_agent` Response Block

Present on all metered endpoints (`/ticker-returns`, `/metrics/{ticker}`, `/l3-decomposition`, `/batch/analyze`).

```json
{
  "_agent": {
    "cost_usd": 0.005,
    "cost_currency": "USD",
    "latency_ms": 145,
    "request_id": "req_abc123xyz",
    "confidence": {
      "overall": 0.98,
      "factors": {
        "data_freshness": 0.99,
        "coverage": 0.97
      }
    },
    "data_freshness": "2026-02-21T10:30:00Z",
    "billing_code": "ticker_returns_v2",
    "cache_status": "HIT"
  }
}
```

### Field Definitions

| Field | Type | Description |
|---|---|---|
| `cost_usd` | float | Cost deducted from prepaid balance for this request. **0 if served from cache.** |
| `cost_currency` | string | Always `"USD"`. |
| `latency_ms` | integer | Server processing time in milliseconds (not including network round-trip). |
| `request_id` | string | Unique identifier for this request. Include in support emails for debugging. |
| `confidence.overall` | float 0–1 | Data reliability score combining freshness and coverage. |
| `confidence.factors` | object | Per-factor confidence breakdown (data_freshness, coverage). |
| `data_freshness` | ISO 8601 | Timestamp of the as-of date/time for the data returned. |
| `billing_code` | string | Internal classification of the request type (for invoice line items). |
| `cache_status` | enum | `HIT` (served from cache, free), `MISS` (fresh fetch, charged), `BYPASS` (nocache param used, charged). |

---

## HTTP Response Headers

All API responses include these headers:

| Header | Description | Example |
|---|---|---|
| `X-Request-ID` | Unique request identifier (same as `_agent.request_id`) | `req_abc123xyz` |
| `X-Response-Latency-Ms` | Server processing time in ms | `145` |
| `X-API-Cost-USD` | Cost deducted for this request as a string | `"0.005"` |
| `X-API-Cost-Currency` | Always `"USD"` | `"USD"` |
| `X-API-Billing-Code` | Internal billing classification | `"ticker_returns_v2"` |
| `X-Confidence-Score` | Data reliability score 0–1 | `"0.98"` |
| `X-Data-Freshness` | ISO timestamp of the data's as-of date | `"2026-02-21T10:30:00Z"` |
| `X-Cache-Status` | Cache result: `HIT`, `MISS`, or `BYPASS` | `"MISS"` |

---

## Cache Behaviour

- **HIT**: Response served from cache. `cost_usd` = 0, `X-API-Cost-USD` = `"0"`. No balance deducted.
- **MISS**: Fresh data fetched. Normal cost applies.
- **BYPASS**: Append `?nocache=true` to any request to force a fresh fetch. Cost applies even if the data hasn't changed.

Default cache TTLs:
- `/metrics/{ticker}`: 5 minutes (`Cache-Control: public, s-maxage=300, stale-while-revalidate=600`)
- `/ticker-returns`: varies by `years` parameter
- `/l3-decomposition`: 1 hour

---

## Unit Conventions

| Unit label | Meaning | Fields |
|---|---|---|
| `dollar_ratio` | Dollar of factor ETF per $1 of stock position | All `_hr` fields |
| `decimal_fraction` | Decimal 0.0–1.0 (not percentage) | All `_er` fields |
| `annualized_decimal` | Annualised value as decimal (e.g. 0.32 = 32%) | `volatility` |

To convert to percentage: multiply by 100.

---

## Data Freshness Validation

Use this helper to detect stale data:

```python
from datetime import datetime

def validate_freshness(metadata, max_age_days=7):
    """
    Check that data is not older than max_age_days.
    metadata: dict with 'as_of' key (ISO date string)
    Returns True if data is fresh enough.
    """
    as_of_date = datetime.fromisoformat(metadata['as_of'])
    age_days = (datetime.utcnow().date() - as_of_date.date()).days
    return age_days <= max_age_days

# Usage with _agent block:
def check_agent_freshness(response_body, max_age_days=3):
    freshness_str = response_body.get('_agent', {}).get('data_freshness', '')
    if not freshness_str:
        return True  # No freshness info — assume ok
    as_of = datetime.fromisoformat(freshness_str.replace('Z', '+00:00'))
    age_days = (datetime.utcnow().date() - as_of.date()).days
    if age_days > max_age_days:
        print(f"Warning: Data is {age_days} days old (limit: {max_age_days})")
        return False
    return True
```

---

## Pricing Reference

| Endpoint | Cost | Notes |
|---|---|---|
| `GET /api/ticker-returns` | $0.005/call | Same cost regardless of `years` parameter |
| `GET /api/metrics/{ticker}` | $0.005/call | — |
| `GET /api/l3-decomposition` | $0.01/call | — |
| `POST /api/batch/analyze` | $0.002/position | Min $0.01/call. 25% cheaper than individual calls. |
| `GET /api/tickers` | $0.001/call | — |
| `GET /api/telemetry` | $0.002/call | Optional `capability`, `days` query params |
| `POST /api/chat` | Per token | Input/output per 1k tokens; see agent manifest |
| `GET /api/balance` | Free | — |
| `GET /api/invoices` | Free | — |
| `GET /api/health` | Free | — |
| `GET /.well-known/agent-manifest` | Free | — |
| Cache hits | Free | Any endpoint served from cache |

Minimum top-up: $10.00 USD. Top up at [riskmodels.net/settings](https://riskmodels.net/settings).
