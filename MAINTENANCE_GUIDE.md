# Maintainer guide (RiskModels_API)

Short reference for operators working on the public API repo while Vercel is live. End-user agent instructions stay in [AGENTS.md](./AGENTS.md); deeper repo-sync rules live in [SKILL.md](./SKILL.md) and [.agents/skills/repo-sync/SKILL.md](./.agents/skills/repo-sync/SKILL.md).

## Vercel and environment

- Full variable list and Doppler/CLI flows: [DEPLOYMENT.md](./DEPLOYMENT.md).
- **`npm run vercel:sync-env`** only uploads an allowlisted subset from `.env.local` ([`scripts/sync-env-to-vercel.sh`](./scripts/sync-env-to-vercel.sh)). Set other secrets (e.g. `API_KEY_SECRET`) manually in Vercel or via Doppler’s Vercel integration.
- **Gateway:** `RISKMODELS_API_SERVICE_KEY` authorizes trusted server-to-server access to gateway-style routes ([`lib/gateway-auth.ts`](./lib/gateway-auth.ts)).

## Webhooks (outbound)

- Operator guide (not in the public clone): `internal/WEBHOOKS_GUIDE.md` — **gitignored**; see [`internal/README.md`](./internal/README.md).
- Apply [`supabase/migrations/20250326120000_webhook_subscriptions.sql`](./supabase/migrations/20250326120000_webhook_subscriptions.sql) on Supabase before relying on subscription APIs.
- Signing uses **per-subscription secrets** in the database, not a global webhook env var ([`DEPLOYMENT.md`](./DEPLOYMENT.md) webhooks subsection).

## Cross-repo drift (RiskModels_API vs Risk_Models)

- CI: [`.github/workflows/drift-detection.yml`](./.github/workflows/drift-detection.yml) compares canonical schemas and OpenAPI when relevant paths change (requires `REPO_ACCESS_TOKEN` for the private Risk_Models checkout).
- When you change `mcp/data/schemas/*`, `schema-paths.json`, or `OPENAPI_SPEC.yaml`, follow [.cursor/rules/repo-sync-enforcer.mdc](./.cursor/rules/repo-sync-enforcer.mdc) and update Risk_Models copies as documented in the skill.

## MCP data sync from Risk_Models

- Script: [`sync-mcp-from-risk-models.sh`](./sync-mcp-from-risk-models.sh) (run from repo root). It runs `generate-mcp-data` in `riskmodels_com` and copies `mcp-server/data` into this repo’s `mcp/data/`.
- [`mcp/README.md`](./mcp/README.md) describes the MCP package and when to refresh static data.

## Optional tooling

- **`npx repomix`** can pack the repo for LLM context; it is **not** required for drift detection or CI.
- **`GET /api/health`** exposes service health via [`lib/agent/telemetry`](./lib/agent/telemetry.ts); treat any third-party “data vendor completeness” claims as documentation-only unless reflected in the actual JSON response.
