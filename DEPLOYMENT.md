# Vercel Deployment

## 1. Connect Repository

1. Go to [vercel.com](https://vercel.com) → Add New → Project
2. Import `Cerebellum-Archive/RiskModels_API` from GitHub
3. Framework: **Next.js** (auto-detected)
4. Root Directory: `.` (default)
5. Build Command: `npm run build` (default)
6. Output Directory: `.next` (default)

## 2. Environment Variables

**Preferred:** manage canonical values in Doppler, then pull/export them into `.env.local` before syncing or deploying.

**Doppler dashboard ↔ Vercel (OAuth):** automatic sync is configured in Doppler under Integrations → Vercel (not via CLI). See [Doppler: Vercel](https://docs.doppler.com/docs/vercel).

**CLI-only equivalent:** push allowlisted secrets from a Doppler config into this linked Vercel project:

```bash
DOPPLER_PROJECT=erm3 DOPPLER_CONFIG=prd VERCEL_ENVS=production npm run vercel:sync-env:doppler
```

Requires `doppler` + `vercel` CLIs, `jq`, `doppler login`, `vercel login`, and `npx vercel link`. Keys are limited to `scripts/doppler-vercel-allowlist.txt` so unrelated Doppler secrets are not uploaded.

**Option A — Sync from .env.local (mirrored from Doppler):**
```bash
npx vercel link   # if not already linked
npm run vercel:sync-env
```

**Option B — Manual:** In Vercel → Project → Settings → Environment Variables, add:

| Variable | Required | Environments | Notes |
|----------|----------|--------------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✓ | All | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✓ | All | Supabase anon/public key |
| `NEXT_PUBLIC_APP_URL` | ✓ | Production | `https://riskmodels.app` (or your custom domain) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | All | Supabase service role (server-only) |
| `RISKMODELS_API_SERVICE_KEY` | ✓ | All | Canonical gateway/service key for trusted `/api/data/*` access |
| `STRIPE_SECRET_KEY` | ✓ | All | Stripe secret key (server-only) |

For **Preview** deployments, `NEXT_PUBLIC_APP_URL` is optional — the app falls back to `VERCEL_URL` (auto-set by Vercel) for Stripe redirects.

Set only `RISKMODELS_API_SERVICE_KEY` for gateway authentication.

### Which keys are “new”? (webhooks and other features)

The table above is the **baseline** production set—assume you need all of them for a full portal deploy unless you know you omit a feature (e.g. Stripe in a throwaway env).

| What you’re enabling | New Vercel / Doppler keys? | What you do |
|----------------------|----------------------------|-------------|
| **Outbound webhooks** (`POST /api/webhooks/subscribe`, `batch.completed` notifications) | **None.** Signing uses **per-subscription secrets in Supabase**, not a global env var. | Apply [`supabase/migrations/20250326120000_webhook_subscriptions.sql`](./supabase/migrations/20250326120000_webhook_subscriptions.sql). Keep **`SUPABASE_SERVICE_ROLE_KEY`** set so the API can read/write `webhook_subscriptions`. |
| **Trusted gateway** (`/api/data/*` with service key) | **`RISKMODELS_API_SERVICE_KEY`** is the key for that pattern (already in the table). | Not webhook-specific—same variable as gateway auth. |
| **PyPI Python SDK (`riskmodels-py`)** | **None** on Vercel | Users install from PyPI; no extra server env for “0.2.0 SDK” itself. |
| **Landing “Live Demo”** / hashed API keys | Often **`NEXT_PUBLIC_DEMO_API_KEY`**, **`API_KEY_SECRET`**, **`API_KEY_SALT`** | Listed in [`.env.example`](./.env.example); **not** in `npm run vercel:sync-env`—set manually in Vercel or Doppler if you use those features. |

So: **webhooks did not add a new row to the Vercel env table**—they rely on **Supabase + the migration** plus the service role key you already use for server-side DB access.

### `npm run vercel:sync-env` allowlist

[`scripts/sync-env-to-vercel.sh`](scripts/sync-env-to-vercel.sh) only pushes a **fixed list** of keys (e.g. Supabase public URL/keys, `SUPABASE_SERVICE_ROLE_KEY`, `RISKMODELS_API_SERVICE_KEY`, `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_APP_URL`). It does **not** mirror every line in `.env.local`. Secrets such as **`API_KEY_SECRET`** (API key hashing) must be set **manually** in Vercel (or via Doppler’s Vercel integration) if you use them—see [`scripts/sync-secrets-to-gh.sh`](scripts/sync-secrets-to-gh.sh) for policies on what never syncs to GitHub.

### Webhooks (outbound subscriptions)

- **Not** a separate “webhook signing” env var: outbound `X-RiskModels-Signature` uses **per-subscription secrets** stored in Supabase (`webhook_subscriptions`), not `API_KEY_SECRET`. Maintainer-only webhook documentation: `internal/WEBHOOKS_GUIDE.md` (gitignored; see [`internal/README.md`](./internal/README.md)).
- Apply [`supabase/migrations/20250326120000_webhook_subscriptions.sql`](./supabase/migrations/20250326120000_webhook_subscriptions.sql) before enabling `POST /api/webhooks/subscribe` in production.
- Clients register at **`POST /api/webhooks/subscribe`** (not `/subscribe`).

## GitHub Actions (smoke test)

The workflow [`.github/workflows/smoke-test.yml`](.github/workflows/smoke-test.yml) exercises production `riskmodels.app`.

**Repository secret (required for full coverage):** add **`TEST_API_KEY`** in GitHub → **Settings → Secrets and variables → Actions** with a valid **live** RiskModels API key (`rm_agent_live_…` or equivalent). The workflow uses it as `Authorization: Bearer …` for `/api/tickers`, `/api/balance`, and `/api/auth/free-tier-status`.

If `TEST_API_KEY` is **unset**, the authenticated step is **skipped** (health + OpenAPI + 401 checks still run), so the workflow can appear green without billing/auth coverage. Set the secret so maintainers get alerted when authenticated paths regress.

### Debugging Actions with the GitHub CLI (`gh`)

Useful when a workflow shows **failure in ~0s** and **no job logs** — often **invalid workflow YAML** (GitHub will not schedule jobs; `gh run rerun` may say the workflow file is broken).

```bash
# Recent runs (JSON)
gh run list --limit 15 --json conclusion,displayTitle,workflowName,url,createdAt

# Filter by workflow file
gh run list --workflow ci.yml --limit 5

# Open a run in the browser (replace RUN_ID)
gh run view RUN_ID --web

# Jobs for a run (empty job list ⇒ workflow never started)
gh api repos/OWNER/REPO/actions/runs/RUN_ID/jobs
```

Replace `OWNER/REPO` (e.g. `Cerebellum-Archive/RiskModels_API`) and `RUN_ID`. Repo-local shorthand: run these from a clone with `gh` authenticated (`gh auth login`).

Main CI workflow: [`.github/workflows/ci.yml`](.github/workflows/ci.yml) (lint, typecheck, Next build, `cli/` build). Smoke test: [`.github/workflows/smoke-test.yml`](.github/workflows/smoke-test.yml).

## 3. Supabase Auth Redirect URLs

In Supabase → Authentication → URL Configuration:

- **Site URL:** `https://riskmodels.app`
- **Redirect URLs:** Add:
  - `https://riskmodels.app/**`
  - `https://riskmodels.app/get-key`
  - `https://*.vercel.app/**` (for preview deployments)

### OAuth providers (Google, GitHub)

The developer portal (`/get-key`) uses **Google** and **GitHub** OAuth plus email magic links, same Supabase providers as the sibling **Risk_Models** app (`riskmodels_com`). Enable each provider under Supabase → Authentication → Providers and add the client ID/secret. For Google setup notes and troubleshooting, use the Risk_Models doc: `Risk_Models/riskmodels_com/docs/integrations/GOOGLE_AUTH_SETUP.md` (clone path may vary).

## 4. Stripe

Stripe Setup Mode uses `NEXT_PUBLIC_APP_URL` for success/cancel redirects. Ensure:

- Production: `NEXT_PUBLIC_APP_URL=https://riskmodels.app`
- Stripe Dashboard → Developers → Webhooks: Add endpoint if you use webhooks (optional for setup-only flow)

## 5. Custom Domain (Optional)

In Vercel → Project → Settings → Domains:

- Add `riskmodels.app` (or your domain)
- Point DNS A/CNAME records as Vercel instructs

---

### Preview deployments

Stripe redirects use `getAppUrl()` which falls back to `VERCEL_URL` when `NEXT_PUBLIC_APP_URL` is unset. Preview deployments work without extra config. For production, set `NEXT_PUBLIC_APP_URL=https://riskmodels.app`.

---

## Maintainer workflows

For Vercel + Supabase + cross-repo sync (MCP data, drift CI, webhook rollout), see [MAINTENANCE_GUIDE.md](./MAINTENANCE_GUIDE.md).
