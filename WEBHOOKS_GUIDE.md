# Webhooks

RiskModels can notify your server when certain events occur. Subscriptions are per user and are managed over HTTPS.

## Managing subscriptions

- **Create:** `POST /api/webhooks/subscribe` with a JSON body: `url` (HTTPS), `events` (array of event names), optional `active`, optional `secret` (if omitted, a secret is generated and returned once).
- **List:** `GET /api/webhooks/subscribe` — returns subscriptions **without** secrets.
- **Delete:** `DELETE /api/webhooks/subscribe?id=<uuid>`.

Authenticate with the same **Bearer** token you use for other API routes (API key or OAuth2 JWT). See [AUTHENTICATION_GUIDE.md](./AUTHENTICATION_GUIDE.md).

Apply the database migration in [`supabase/migrations/20250326120000_webhook_subscriptions.sql`](./supabase/migrations/20250326120000_webhook_subscriptions.sql) to your Supabase project before using this feature.

## Event types

| Event | When it fires |
|--------|----------------|
| `batch.completed` | After a successful `POST /api/batch/analyze` run completes (JSON or Parquet/CSV export). |

### `batch.completed` payload

The body is JSON with a fixed shape:

```json
{
  "event": "batch.completed",
  "timestamp": "2026-03-26T12:00:00.000Z",
  "data": {
    "request_id": "<billing/request correlation id>",
    "format": "json",
    "summary": { "total": 10, "success": 9, "errors": 1 },
    "ticker_count": 10
  }
}
```

`format` is `json`, `parquet`, or `csv` depending on the batch request.

## Request headers

Each delivery is an HTTP `POST` to your `url` with:

| Header | Meaning |
|--------|---------|
| `Content-Type` | `application/json; charset=utf-8` |
| `X-RiskModels-Event` | Event name (e.g. `batch.completed`) |
| `X-RiskModels-Signature` | HMAC-SHA256 over the **raw** request body bytes, hex digest prefixed with `sha256=` |

Signature computation (same as server):

1. Let `body` be the exact UTF-8 string of the JSON payload (no pretty-printing; must match the bytes received).
2. Compute `hex = HMAC_SHA256(secret, body)` where `secret` is the subscription secret returned at creation.
3. Compare the header to `sha256=` + `hex` using a **constant-time** comparison.

### Node.js verification example

```javascript
import { createHmac, timingSafeEqual } from "crypto";

function verifyRiskModelsWebhook(rawBodyBuffer, headerSignature, secret) {
  const expected =
    "sha256=" +
    createHmac("sha256", secret).update(rawBodyBuffer).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(headerSignature.trim(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
```

Use the **raw** request body (before JSON parsing) for HMAC verification, then `JSON.parse` the buffer.

## Security notes

- Only **HTTPS** URLs are accepted for subscriptions.
- Treat the subscription **secret** like an API key: store it securely, rotate by deleting a subscription and creating a new one.
- Deliveries may arrive more than once if a timeout or retry is added later; design your handler to be **idempotent** (e.g. key on `request_id` + `event`).
- Your endpoint should return `2xx` quickly; long work should be queued on your side.
