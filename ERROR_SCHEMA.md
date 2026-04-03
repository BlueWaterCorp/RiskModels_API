# Error Schema

All API errors follow a consistent JSON envelope. This document defines the error format, all error codes, and recovery patterns.

---

## Error Response Envelope

```json
{
  "error": "TICKER_NOT_FOUND",
  "message": "Ticker 'XYZABC' not found in universe 'uni_mc_3000'. Check ticker spelling or try a different universe.",
  "code": 404,
  "details": {
    "field": "ticker",
    "received": "XYZABC",
    "universe": "uni_mc_3000",
    "suggestion": "Check for typos or use ticker search endpoint"
  }
}
```

### Fields

| Field | Type | Description |
|---|---|---|
| `error` | string | Machine-readable error code (SCREAMING_SNAKE_CASE). Use for programmatic handling. |
| `message` | string | Human-readable description with suggested action. |
| `code` | integer | HTTP status code (mirrors the HTTP response status). |
| `details` | object | Optional. Additional context: field name, received value, universe, and suggestion. |

---

## Error Catalogue

### 4xx Client Errors

| Code | HTTP | Meaning | Recovery |
|---|---|---|---|
| `AUTHENTICATION_REQUIRED` | 401 | Missing, malformed, or expired Bearer token. | Verify token format: `rm_agent_{live\|test}_{random}_{checksum}`. Re-provision via `POST /api/auth/provision`. |
| `INSUFFICIENT_BALANCE` | 402 | Prepaid balance too low to cover request cost. | Top up at `POST /api/billing/top-up` or via [riskmodels.net/settings](https://riskmodels.net/settings). Check balance: `GET /api/balance`. |
| `INVALID_REQUEST_BODY` | 400 | Malformed JSON or missing required fields in request body. | Check request shape against [OPENAPI_SPEC.yaml](OPENAPI_SPEC.yaml). |
| `TOO_MANY_TICKERS` | 400 | Batch request contains more than 100 tickers. | Split into multiple calls with ≤ 100 tickers each. |
| `TICKER_NOT_FOUND` | 404 | Ticker not in universe `uni_mc_3000`. | Search for the ticker: `GET /api/tickers?search=SYMBOL`. Check for typos or delisted symbols. |
| `DATE_NOT_AVAILABLE` | 404 | Requested date is a non-trading day or outside the available range (2006-01-04 to present). | Use `GET /api/tickers?array=teo` to retrieve valid trading dates. |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests per minute. | Implement exponential backoff starting at 1 second. Respect the `Retry-After` response header. |

### 5xx Server Errors

| Code | HTTP | Meaning | Recovery |
|---|---|---|---|
| `INTERNAL_SERVER_ERROR` | 500 | Unexpected server-side error. | Retry with exponential backoff (1s, 2s, 4s). If persistent, check `GET /api/health` and open an issue. |
| `MANIFEST_GENERATION_FAILED` | 500 | Agent manifest temporarily unavailable. | Retry after 5 seconds. |
| `DATABASE_ERROR` | 500 | Upstream Supabase/database error. | Check `GET /api/health` for service status. Retry with backoff. |

---

## Recovery Patterns

### 401 AUTHENTICATION_REQUIRED

```python
import requests

def make_request_with_retry(url, headers, max_retries=1):
    resp = requests.get(url, headers=headers)
    if resp.status_code == 401:
        # Re-provision token
        new_key = provision_new_token()
        headers["Authorization"] = f"Bearer {new_key}"
        resp = requests.get(url, headers=headers)
    resp.raise_for_status()
    return resp.json()
```

### 402 INSUFFICIENT_BALANCE

```python
def check_balance_before_workflow(headers, min_balance=1.0):
    resp = requests.get("https://riskmodels.app/api/balance", headers=headers)
    balance = resp.json()
    if balance["balance_usd"] < min_balance:
        raise ValueError(
            f"Insufficient balance: ${balance['balance_usd']:.4f}. "
            f"Top up at https://riskmodels.net/settings"
        )
```

### 429 RATE_LIMIT_EXCEEDED

```python
import time

def request_with_backoff(url, headers, max_retries=5):
    for attempt in range(max_retries):
        resp = requests.get(url, headers=headers)
        if resp.status_code == 429:
            retry_after = int(resp.headers.get("Retry-After", 2 ** attempt))
            print(f"Rate limited. Waiting {retry_after}s...")
            time.sleep(retry_after)
            continue
        resp.raise_for_status()
        return resp.json()
    raise RuntimeError("Max retries exceeded")
```

### 5xx Server Errors

```python
def resilient_request(url, headers, max_retries=3):
    backoff = 1
    for attempt in range(max_retries):
        resp = requests.get(url, headers=headers)
        if resp.status_code >= 500:
            print(f"Server error {resp.status_code}. Retrying in {backoff}s...")
            time.sleep(backoff)
            backoff *= 2
            continue
        resp.raise_for_status()
        return resp.json()
    raise RuntimeError(f"Request failed after {max_retries} retries")
```

---

## SDK Validation (Instructional Warnings)

The `riskmodels-py` Python SDK provides client-side validation with instructional error messages. These supplement the HTTP errors above and help agents and developers self-correct.

### ValidationWarning (default mode)

When `validate="warn"` (default), the SDK emits Python warnings for data-quality issues:

```python
from riskmodels import RiskModelsClient

client = RiskModelsClient.from_env()
pa = client.analyze({"GOOGL": 0.6, "NVDA": 0.4})  # GOOGL is an alias

# Output:
# Warning: Ticker alias detected: GOOGL → GOOG (canonical in universe uni_mc_3000).
# Fix: Use GOOG in all future API calls to avoid ambiguity and ensure consistent identity.
```

**Format:** `Warning: {issue description} Fix: {recommended action}`

### RiskModelsValidationError (strict mode)

When `validate="error"`, the SDK raises exceptions instead of warnings:

```python
client = RiskModelsClient.from_env(validate="error")
pa = client.analyze({"NVDA": 1.0})

# Raises RiskModelsValidationError if ER sum is out of tolerance:
# Error: L3 explained-risk components sum to 1.0523, expected 1.0 ± 0.05.
# Fix: Treat as a data-quality flag; verify model version and as-of date match your research slice.
```

### Common validation checks

| Check | Trigger | Fix |
|---|---|---|
| **Ticker alias** | GOOGL, BRK-B, BF-B, or other remapped symbols | Use the canonical ticker logged in the warning |
| **ER sum out of tolerance** | `l3_market_er + l3_sector_er + l3_subsector_er + l3_residual_er` ≠ 1.0 ± 0.05 | Verify model version matches your slice; may indicate partial modelling |
| **Negative HR** | Any `*_hr` < 0 | Usually valid (orthogonalization); **market HR at L2/L3 is often negative**. Use `validate="error"` only when you have explicit QA rules; do not assume a sign bug. |

All validation issues include a `Fix:` line so agents can self-correct without manual intervention.

---

## Checking Service Status

Before running a batch workflow, verify the service is healthy:

```python
health = requests.get("https://riskmodels.app/api/health").json()
if health["status"] != "up":
    print(f"Service degraded: {health['status']}")
    # Check health["services"] for which component is affected
```

Report persistent issues at [github.com/Cerebellum-Archive/RiskModels_API/issues](https://github.com/Cerebellum-Archive/RiskModels_API/issues) or email [service@riskmodels.app](mailto:service@riskmodels.app).
