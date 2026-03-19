# Vercel Deployment

## 1. Connect Repository

1. Go to [vercel.com](https://vercel.com) → Add New → Project
2. Import `Cerebellum-Archive/RiskModels_API` from GitHub
3. Framework: **Next.js** (auto-detected)
4. Root Directory: `.` (default)
5. Build Command: `npm run build` (default)
6. Output Directory: `.next` (default)

## 2. Environment Variables

**Option A — Sync from .env.local:**
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
| `STRIPE_SECRET_KEY` | ✓ | All | Stripe secret key (server-only) |

For **Preview** deployments, `NEXT_PUBLIC_APP_URL` is optional — the app falls back to `VERCEL_URL` (auto-set by Vercel) for Stripe redirects.

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
