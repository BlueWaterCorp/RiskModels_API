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

`GATEWAY_SERVICE_KEY` is still accepted as a temporary legacy alias in code, but new deploys should set only `RISKMODELS_API_SERVICE_KEY`.

## 3. Supabase Auth Redirect URLs

In Supabase → Authentication → URL Configuration:

- **Site URL:** `https://riskmodels.app`
- **Redirect URLs:** Add:
  - `https://riskmodels.app/**`
  - `https://riskmodels.app/get-key`
  - `https://*.vercel.app/**` (for preview deployments)

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
