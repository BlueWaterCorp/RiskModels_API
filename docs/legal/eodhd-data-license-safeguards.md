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
| Data gateway (`/api/data/*`, soft auth, no billing) | Per-IP Upstash sliding-window limit at the middleware chokepoint; service-key callers exempt; fails open | `lib/ratelimit/data-gateway-rate-limit.ts`, `middleware.ts` (`DATA_GATEWAY_RPM`, default 120/min) |
| Raw-field surface | No multi-symbol raw export exists — raw is per-symbol only (B(e) gating above), so single-call dataset reconstruction is structurally impossible | see B(e) |
| Public endpoints (`skipBilling`) | Per-IP rate limit | `lib/agent/billing-middleware.ts` |

Tests: `tests/data-gateway-rate-limit.test.ts`.

**Contractual:** B(g) also calls for *contractual* safeguards (end users bound
against scraping / redistribution). The API Terms of Service / acceptable-use
clause is the contractual half — see follow-up below.

## Open follow-ups

- **Contractual AUP clause** (B(g) contractual half): ensure the published API
  Terms include explicit no-scraping / no-bulk-extraction / no-redistribution-of-
  raw-data language. Lives on the public site (RM_ORG), not this repo.
- The €350→€700/mo step-up is intro-rate expiry (~May 2027), not a redistribution
  charge — renegotiate or re-confirm scope before then if desired.
