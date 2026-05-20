# Plaid routes on `riskmodels.app` (audit)

Routes under `app/api/plaid/`:

| Path | Purpose |
|------|---------|
| `link-token` | Create Plaid Link token |
| `exchange-public-token` | Exchange public token for access token |
| `holdings` | Fetch holdings |

## Decision (Phase 2 hygiene)

These endpoints are **consumer-dashboard concerns** (historically aligned with `.net`), not core developer API surface. They remain in this repo for now as a **shared backend** option: `.net` or other clients may call them with the correct env (`PLAID_*` secrets).

**Do not** add them to the public OpenAPI developer contract unless product explicitly ships “Plaid on .app.”

## Follow-ups

- If Plaid moves entirely off this deploy: delete routes and env, or proxy from `.net` only.
- If they stay: add a one-line pointer in internal onboarding so API readers are not surprised.
