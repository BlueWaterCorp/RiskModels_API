# Maintainer guide (RiskModels_API)

Short reference for operators working on the public API repo while Vercel is live. End-user agent instructions stay in [AGENTS.md](./AGENTS.md); deeper repo-sync rules live in [SKILL.md](./SKILL.md) and [.agents/skills/repo-sync/SKILL.md](./.agents/skills/repo-sync/SKILL.md).

## Local API (fast iteration)

1. **Run the app** from the repo root: `npm run dev` → routes under **`http://localhost:3000/api/*`** (same surface as production).
2. **Point the Python SDK / scripts at localhost** — in `.env.local` set:
   - `RISKMODELS_BASE_URL=http://localhost:3000/api`
   - `RISKMODELS_API_KEY=...` (a key your local app can validate; usually the same shape as prod if you use the same Supabase project and key hashing envs).
3. **`load_repo_dotenv()`** (SDK) and `scripts/generate_readme_assets.py` read `.env.local`, so no extra `export` is needed once the file is saved.
4. **Data dependencies** — correlation, rankings, metrics, etc. still call Supabase and Redis configured in `.env.local`. Point `NEXT_PUBLIC_SUPABASE_*` / `SUPABASE_SERVICE_ROLE_KEY` at a dev project or the real project; without valid DB data, routes may 404/500 even when code is correct.
5. **Iterate** — edit route handlers under `app/api/`, save, hit the same path via the SDK or `curl`; no deploy cycle.

CORS already allows `http://localhost:3000` for browser clients ([`lib/cors.ts`](./lib/cors.ts)).

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
