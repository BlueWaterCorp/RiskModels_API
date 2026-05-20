# Onboarding cleanup — key email issuance audit

**Status:** Approved  
**Updated:** 2026-04-28

## Summary

Phase 3 of the onboarding plan required tracing **who sends** API key emails before adding workflow selectors.

## Verified paths

| Source | Mechanism | Template / behavior |
|--------|-----------|---------------------|
| **riskmodels.app** | `app/api/agent-keys/route.ts` (and related UI) | [`emails/key-issued.tsx`](../emails/key-issued.tsx) via Resend — primary “rich” onboarding email. |
| **riskmodels.net (portal)** | Typed `sendEmail` in `Risk_Models/riskmodels_com/src/lib/email-service.ts` | Does **not** include a `free-api-key` template; transactional types are welcome, billing, usage, etc. |
| **Legacy queue** | `Risk_Models/riskmodels_com/src/lib/email.ts` | Supports `api-key-issued` subject mapping; separate from typed `sendEmail`. |
| **`free-api-key.tsx`** | Template file exists under portal | Not wired into `sendEmail` in the audited pass; Stripe/setup flows may redirect without emailing plaintext keys (see internal production auth notes). Template updated anyway so it stays accurate if reused. |

## Decision (first pass)

- **No UI workflow selector** at key issuance in this iteration.
- **`key-issued.tsx`**: Added deterministic `npx -y riskmodels@latest install` block plus manual `mcp-remote` path for advanced users — one email covers agent vs manual MCP.
- **Portal `free-api-key.tsx`**: Added optional MCP install section linking to **riskmodels.app/quickstart** for consistency.

## Follow-ups (optional)

- Wire `FreeApiKeyEmail` from a single issuance path if product wants parity with `.app` emails.
- Add explicit `workflow` field on keys when UX has a natural home for it.
