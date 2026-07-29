# Memo: API and client updates — July 2026

**For:** interns and anyone writing code against the RiskModels API
**Read time:** ~5 minutes
**TL;DR:** if you use an **API key**, nothing you wrote will break. If you followed the old
OAuth "client credentials" instructions, that code never actually worked, and now it fails
loudly instead of silently. Update both client packages.

---

## 1. Update your packages

```bash
pip install -U riskmodels-py     # 0.3.11 → 0.4.0
npm  install -g riskmodels       # 2.1.0  → 3.0.0
```

The Python wheel dropped from 33 MB to 0.33 MB, so this is also a much faster install than
you may remember.

---

## 2. The one breaking change: `client_id` / `client_secret` are gone

If you have code like this, it needs to change:

```python
# ❌ Removed in 0.4.0 — and it never worked in the first place
client = RiskModelsClient(client_id="...", client_secret="...")
```

```python
# ✅ Use an API key
client = RiskModelsClient(api_key="rm_agent_live_...")

# or, reading RISKMODELS_API_KEY from the environment
client = RiskModelsClient.from_env()
```

Same for the CLI: `RISKMODELS_CLIENT_ID` / `RISKMODELS_CLIENT_SECRET` /
`RISKMODELS_OAUTH_SCOPE` are gone, as is `riskmodels config set clientId|clientSecret|oauthScope`.
Use `RISKMODELS_API_KEY`, or `riskmodels config set apiKey ...`.

### Why — this is the interesting part

Our docs described an OAuth 2.0 **client credentials** flow: POST your credentials to
`/api/auth/token`, get back a short-lived token, use that as your Bearer.

That endpoint was never built. It returns **404**. The documentation, the OpenAPI spec, the
Python SDK, and the npm CLI all described and implemented a flow the server did not have.

It survived for a long time for a reason worth internalising: **the SDK's test suite mocked
the endpoint.** The test asserted "the SDK posts to `/api/auth/token`" — which was true — and
passed on every run, while the feature was broken for every real user. The contract, the
client, and the test all agreed with each other, and all disagreed with the server.

> **Takeaway:** a mock proves your code calls what you *think* exists. It proves nothing about
> whether that thing exists. If a test mocks a boundary you own, something in CI should also
> touch the real boundary.

Supplying those credentials now raises immediately with instructions, rather than building a
client that dies on its first request.

---

## 3. How authentication actually works

There are two ways in, and they are for different things.

### Bearer API key — use this for everything you write

```bash
curl -H "Authorization: Bearer rm_agent_live_..." \
  https://riskmodels.app/api/metrics/NVDA
```

There is **no token exchange step**. The key goes straight in the header.

Get a key at [riskmodels.app/get-key](https://riskmodels.app/get-key) — a card gets you $20
of free credit. For quick experiments there is also a keyless free tier via
`POST /api/auth/provision-free` (100 queries/day, 10/min, max 3 keys per IP per day).

Key formats: `rm_agent_*` (provisioned accounts) and `rm_user_*` (issued by the OAuth flow
below). Both are used identically.

### OAuth 2.0 authorization code + PKCE — only for MCP clients

This is what Claude Desktop, Cursor, ChatGPT, and Grok use when you add the MCP connector.
You will almost never call it by hand. It issues an `rm_user_*` key that you then use exactly
like any API key.

- Grants: `authorization_code` (PKCE, S256) and `refresh_token` — **not** `client_credentials`
- Endpoints: `/api/oauth/register`, `/api/oauth/token`, `/api/oauth/revoke`
- Discovery: [`/.well-known/oauth-authorization-server`](https://riskmodels.app/.well-known/oauth-authorization-server)

Refresh tokens **rotate**: each use returns a new one and invalidates the old. If you replay
an already-used refresh token, we treat it as a theft signal and revoke the whole family for
that user + client. So always persist the new refresh token you get back.

---

## 4. Behaviour changes you might notice

**Public search endpoints are now rate limited.** `GET /api/funds/search` and
`GET /api/13f/filers/search` still need no API key, but they now allow **60 requests/minute
per IP** and return at most **100 rows** per call (previously unlimited requests, up to 500
rows). If you were paging through everything in a loop, you will start seeing `429`.

**Throttled JSON endpoints return a real `429`.** They used to return HTTP `200` with a
status-badge body, which parsed as a successful empty result — so a scraping loop would
silently think it had reached the end of the data. If you have code that treats "empty
results" as "done", check for `429` too.

**`500` responses no longer include the internal exception text.** You will get a generic
message. The detail is in our server logs — if you hit one, grab the `request_id` from the
response and ask; do not try to parse the message.

**`402` responses now point somewhere real.** Out of balance? The `top_up_url` field and
`X-Top-Up-URL` header used to return `/api/billing/top-up`, which does not exist. They now
return `riskmodels.app/get-key`. There is no programmatic top-up endpoint — top-ups go
through Stripe Checkout.

**`GET /api/pdf/{symbol}/latest` is gone.** Use `GET /api/metrics/{ticker}/snapshot.pdf`.

---

## 5. Nine endpoints that existed but weren't documented

These were always callable; they just weren't in the spec, so you had no way to discover
them. They are now documented with their prices:

| Endpoint | What it does | Cost |
|---|---|---|
| `POST /v4/decompose` | Named-block decomposition: market / industry / style / stock-specific | $0.001 |
| `GET /hedge-basket/{ticker}` | Hedge basket + recommended level + decision trace | $0.001 |
| `GET /batch/latest-metrics` | Latest L3 scalars for up to 100 tickers | $0.001 |
| `GET /metrics/{ticker}/snapshot.png` | Snapshot as PNG bytes | $0.25 |
| `GET /snapshot/{entity_kind}` | Deep Dive snapshot, PNG or PDF bytes | $0.25 |
| `GET /funds/search` | Fund discovery → `bw_fund_id` | free |
| `POST /oauth/{register,token,revoke}` | The MCP OAuth flow | free |

Note the two image endpoints return **bytes, not JSON** — don't call `.json()` on them.

---

## 6. Where to look things up

Check these before asking, and before writing a client:

| Source | Use it for |
|---|---|
| [`riskmodels.app/openapi.json`](https://riskmodels.app/openapi.json) | The contract. Authoritative. |
| [`riskmodels.app/api-reference`](https://riskmodels.app/api-reference) | Same thing, browsable |
| [`riskmodels.app/llms.txt`](https://riskmodels.app/llms.txt) | Point an AI agent here |
| `ERROR_SCHEMA.md` | Error codes and what to do about each |
| `AUTHENTICATION_GUIDE.md` | The four auth modes in depth |
| `SEMANTIC_ALIASES.md` | Metric names — read this before guessing a field name |

---

## 7. Gotchas that will cost you an afternoon

**The system Python cannot build or test the SDK.** macOS ships Python 3.9; this package
needs 3.10+. Running `python3 -m pytest` in `sdk/` produces 55 collection errors that look
like real failures but are just the interpreter. Use the project venv:

```bash
cd sdk && ./.venv/bin/python -m pytest
```

**Metric keys come in two spellings.** The wire format uses abbreviated keys (`l3_res_er`)
and the documentation uses semantic names (`l3_residual_er`). Which one you get depends on
whether the payload went through normalisation. Don't guess — use the helper:

```python
from riskmodels.mapping import first_present
res_er = first_present(metrics, "l3_residual_er", "l3_res_er")
```

**`symbol` is not `ticker`.** `symbol` (e.g. `BW-BBG000B9XRY4`) is the internal join key.
`ticker` (e.g. `NVDA`) is what humans see. Both appear in API responses; never put `symbol`
on a chart axis, in a PDF title, or in anything a user reads.

**Free ≠ unauthenticated.** In our middleware, `skipBilling: true` means the endpoint skips
key validation *entirely* — it is genuinely public, not "authenticated but free". If you add
an endpoint with that flag, assume anyone on the internet can call it, and add a rate limit.

---

## Questions

Ask in the team channel. If something in this memo disagrees with the code, the code is
right and the memo is a bug — please say so.
