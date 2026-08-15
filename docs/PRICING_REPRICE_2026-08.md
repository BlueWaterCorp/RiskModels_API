# Price book 2026-08-14 — catalogue, tiers, R5, migration

Source brief: `Futures/docs/PRICING_REPRICE_BRIEF.md`. Charged rates live in
`RiskModels_API/lib/agent/capabilities.ts`. Public page: `/pricing`.

## 1. Catalogue (before → after)

Rule tags: R1 decision vs data · R2 batch must not erase premium · R3 volume
parameters move price · R4 sibling consistency · R5 copy/price agreement.

| id | was | now | rule |
|---|---|---|---|
| ticker-search, fund-search, filer-search, health-status, cohorts-roster, plaid-link-token, plaid-exchange-public-token | $0 | $0 | discovery / setup — hold |
| metrics, rankings, peers, decompose-position, metrics-snapshot, macro-factor-series | $0.001 | $0.005 | 5× lookups |
| hedge-basket | $0.001 baseline | $0.02 premium | R1 recommended basket |
| telemetry-metrics, factor-correlation | $0.002 | $0.01 | 5× |
| cli-query | $0.003 | $0.015 | 5× |
| ticker-returns | $0.005 flat, years≤15 | $0.02 + $0.01/extra year | specified; R3, R4 |
| fundamentals, universe-members, etf-factor-returns, fund-*, filer-* reads, style-cohort-* (non-PDF) | $0.005 | $0.02 | R4 align with 1y ticker-returns |
| batch-analysis | $0.005/pos, min $0.01 | $0.015/pos, min $0.03 | R2/R4 25% off 1y ticker-returns |
| batch-lstar | $0.005/pos, min $0.01 | $0.015/pos + $0.0075/extra year, min $0.03 | specified R5 |
| lstar | $0.02 | $0.02 + $0.01/extra year | specified hold + R3 |
| residual-signal, residual-signal-basket | $0.02 | $0.02 | specified hold |
| l3-decomposition, risk-decomposition, industry-panel, cohorts | $0.02 | $0.04 | 2× analytics |
| returns-decomposition | $0.02 | $0.04 + $0.01/extra year | 2× + R3 |
| plaid-holdings | $0.02 | $0.10 | 5× operational sync |
| portfolio-returns | $0.004/pos | $0.01/pos + $0.005/extra year, min $0.02 | R3; below batch-analysis |
| cohorts-series | $0.03 | $0.15 | 5× |
| portfolio-risk-index | $0.03 | $0.15 | 5× |
| cohorts-pnl-decomposition, rankings-screen, artifact-render | $0.05 | $0.25 | 5×; R1 screens/attribution |
| fund-snapshot-json, filer-snapshot-json | $0.01 | $0.05 | 5× |
| portfolio-risk-snapshot, fund-snapshot-pdf | $0.25 | $1.25 | 5× PDF |
| style-cohort-snapshot-pdf | $0.10 | $0.50 | 5× |
| filer-snapshot-pdf | $0.05 | $0.25 | 5× |
| chat-risk-analyst | $0.001 / $0.002 per 1k | $0.005 / $0.01 per 1k | 5× tokens |

Open question (not silently assigned): `batch-analysis` at $0.015/pos equals
`batch-lstar` at 1 year, so the Lstar premium in batch is still thin. Raising
`batch-lstar` further would break the specified $0.015. Revisit after the
grandfather window.

`portfolio-returns` default `years=3` now bills two extra-year increments.
That is the R3 correction; callers who want 1 year should pass `years=1`.

## 2. Institutional tiers

| tier | annual | who | non-data inclusions |
|---|---|---|---|
| Desk | $50,000 | one team, one strategy, standard universe | named support, onboarding, deprecation notice |
| Firm | $150,000 | unlimited internal use, full universe | named support, onboarding, availability SLA, deprecation policy |
| Production | $250,000 | systematic dependency | version pinning, contracted SLA, incident contact, deprecation minimum-notice, Firm inclusions |

Public-data POC remains a scoped project, typically $25,000, credited toward a
Desk or Firm license.

## 3. R5 copy/price contradictions found

| surface | copy said | listed price | resolution |
|---|---|---|---|
| `batch-lstar` description | 25% cheaper than `GET /lstar` ($0.02 → $0.015) | $0.005 (75% off) | listed price moved to $0.015 |
| `lib/api-reference-data.ts` batch-analyze | 25% cheaper than `/metrics` ($0.001 → $0.00075); Cost $0.002/pos | capability $0.005/pos | copy aligned to 25% off 1y ticker-returns; $0.015/pos |
| OpenAPI `ticker-search` | capabilities $0 | x-pricing $0.001 | OpenAPI set to $0 (search stays free) |

## 4. Migration

- **Effective:** 14 August 2026 for new keys.
- **Grandfather:** any account with a paid `billing_events` row before that
  date keeps `legacy_*` rates through **31 December 2026** (UTC, inclusive).
- **What existing users are told:** FAQ on `/pricing` — "Keys that recorded a
  paid call before 14 August 2026 keep the prior per-endpoint rates through
  31 December 2026." Cached responses stay free.
- Methodology and data are unchanged.
