# EODHD data-license safeguards (Exhibit B compliance)

Maps the controls in this repo to the signed **Data Services Agreement** with
Unicorn Data Services SAS (EODHistoricalData), effective 2026-05-15.
Master contract: `RiskModels_IP/docs/licensing/EODHD_Agreement_v3_Complete_DocuSign.pdf`.

The agreement grants generous rights — derived analytics redistribution (B(c)/(d))
and per-symbol, authenticated raw-field display (B(e)) — with **no separate
redistribution tier**. The obligations we must actively enforce are the limited-
display conditions (B(e)) and the anti-bulk safeguards (B(g)).

## Restricted raw fields

Only two fields are EODHD raw data under Exhibit B(e); everything else in the V3
metric dictionary is Derived Data (free to redistribute under B(c)/(d)):

| Field | Key |
|---|---|
| End-of-day close price | `price_close` |
| Market capitalization | `market_cap` |

Single source of truth: `lib/data-license.ts` (`RAW_RESTRICTED_KEYS`).

## B(e) — Limited Display of Raw Fields (authenticated, per-symbol, ancillary)

| Surface | Control | Where |
|---|---|---|
| `GET /api/data/security-history/:symbol` | Raw keys → `403` unless service-key authed (per-symbol satisfies per-call); derived keys public | `app/api/data/security-history/[symbol]/route.ts` |
| `POST /api/data/security-history/batch` | Raw keys → `403` (bulk never serves raw); stripped from wide `latest` mode | `app/api/data/security-history/batch/route.ts` |
| `GET /api/data/security-history/latest/:symbol` | Raw cols stripped for unauthenticated callers | `app/api/data/security-history/latest/[symbol]/route.ts` |
| External authenticated raw access | Per-symbol via billed endpoints `/api/metrics/:ticker` (scalar), `/api/ticker-returns` (one symbol) | `withBilling` |

Policy helpers: `lib/data-license.ts`. Tests: `tests/data-license.test.ts`.

## B(g) — Safeguards against bulk download / systematic scraping / reconstruction

**Technical:**

| Layer | Control | Where |
|---|---|---|
| Billed API (`/api/*` via `withBilling`) | Per-API-key Upstash sliding-window rate limit (`429` + `Retry-After`); per-request metered cost (iteration is throttled *and* priced) | `lib/agent/billing-middleware.ts` |
| Data gateway (`/api/data/*`, public read, no billing) | Per-IP Upstash sliding-window limit at the middleware chokepoint; service-key callers exempt. **Degrades, does not fail open** — if Upstash is unconfigured or erroring, falls back to a per-instance ceiling at the same rate and logs `FAIL_OPEN` | `lib/ratelimit/data-gateway-rate-limit.ts`, `lib/ratelimit/memory-fallback.ts`, `middleware.ts` (`DATA_GATEWAY_RPM`, default 120/min) |
| Raw-field surface | No multi-symbol raw export exists — raw is per-symbol only (B(e) gating above), so single-call dataset reconstruction is structurally impossible | see B(e) |
| Public unbilled endpoints (`skipBilling`) | Per-IP rate limit **plus** a row cap on the two bulk-readable discovery endpoints, with the same degrade-not-fail-open behaviour | `lib/agent/billing-middleware.ts` (`publicIpRateLimitPerMinute`) |

Per-endpoint limits for the `skipBilling` surface — `skipBilling` bypasses key
validation entirely, so these are genuinely public and the per-IP cap is the only
control on them:

| Endpoint | Per-IP limit | Row cap | Env var |
|---|---|---|---|
| `GET /api/funds/search` | 60/min | 100 | `FUND_SEARCH_IP_RPM` |
| `GET /api/13f/filers/search` | 60/min | 100 | `FILER_SEARCH_IP_RPM` |
| `GET /api/rankings/{ticker}/badge` | 120/min | n/a | `RANKINGS_BADGE_IP_RPM` |
| `POST /api/landing/chat` | 10/hr | n/a (MAG7-only demo) | — |
| `POST /api/plaid/link-token`, `/api/plaid/exchange-public-token` | n/a — authenticate in-handler (`authenticateOrRespond`), not public | — | — |

> **Correction (2026-07-28).** Before that date this table claimed a per-IP rate
> limit across the `skipBilling` surface as a blanket control. In implementation
> only `/api/rankings/{ticker}/badge` carried one; `/api/funds/search` and
> `/api/13f/filers/search` — the two endpoints that serve fund reference data in
> bulk, and therefore the ones B(g) most directly concerns — had no throttle and
> returned up to 500 rows per call. The data gateway's limiter also failed open
> rather than degrading. Both gaps were found in an internal review of the public
> API surface and closed in the same change that added this correction; the table
> above now describes implemented behaviour, verified by the tests below.

Tests: `tests/data-gateway-rate-limit.test.ts`,
`tests/public-ip-rate-limit-degrades.test.ts` (asserts the per-IP cap still
refuses over-limit callers when the Redis backend is unavailable).

**Contractual:** B(g) also calls for *contractual* safeguards (end users bound
against scraping / redistribution). The API Terms of Service / acceptable-use
clause is the contractual half — see follow-up below.

## Open follow-ups

- **Contractual AUP clause** (B(g) contractual half): ensure the published API
  Terms include explicit no-scraping / no-bulk-extraction / no-redistribution-of-
  raw-data language. Lives on the public site (RM_ORG), not this repo.
- The €350→€700/mo step-up is intro-rate expiry (~May 2027), not a redistribution
  charge — renegotiate or re-confirm scope before then if desired.
