# Google Ads conversion tracking

Account: **RiskModels.app** (Google Ads `849-116-0672`) · Google tag **`AW-18161098219`**
· GA4 **`G-3Q4LR1QFWP`** (stream `RiskModels.app`) — both loaded site-wide by
[`components/GoogleAdsTag.tsx`](../components/GoogleAdsTag.tsx) (IDs in
[`lib/google-tags.ts`](../lib/google-tags.ts)). Client-side route changes send GA4
`page_view` via [`trackGaPageView()`](../lib/google-ads-conversion.ts) in
[`components/posthog-provider.tsx`](../components/posthog-provider.tsx).

## Phase 1 — Sign-up conversion (live)

Goal: count a conversion when a **new account is created** (first sign-in). Accounts are
auto-created on first Google / GitHub / magic-link sign-in, so "first sign-in == sign-up".

**Google Ads conversion action**

| Field | Value |
|---|---|
| Name | `Sign-up` |
| Category | Sign-up (account-default goal, **Primary**) |
| Source | Website — manual event |
| Count | One |
| Value | Same value each time — $1 USD |
| Attribution | Data-driven |
| Click-through window | 90 days |
| Enhanced conversions | On (account-level; email passed in code) |
| send_to | `AW-18161098219/Qn__CI297LocEOu78dND` |

**Code** — [`lib/google-ads-conversion.ts`](../lib/google-ads-conversion.ts), wired into
[`app/get-key/page.tsx`](../app/get-key/page.tsx):

- `reportSignupConversion(user)` fires `gtag('event','conversion', …)` once per new account
  (dedupes via `sessionStorage`; `isNewAccount()` gates on `created_at ≈ last_sign_in_at`).
  Called from `onAuthStateChange` and the OAuth/magic-link code-exchange branch.
- Enhanced Conversions: the unhashed `user.email` is passed via `gtag('set','user_data', …)`;
  the Google tag hashes it client-side.

**Deploy checklist**

1. Merge + deploy to Vercel (production `riskmodels.app`).
2. Create a fresh test account; confirm the `conversion` hit in DevTools → Network
   (`google-analytics`/`googleads` request with the `Qn__CI297LocEOu78dND` label) or the
   Google Ads Tag Assistant.
3. In Google Ads the **Sign-up** goal status moves from *Misconfigured* → *Recording
   conversions* once the first real event arrives (can take a few hours).

> The old **`get-api key page`** action pointed at a non-existent `/get-api` URL (real page is
> `/get-key`; `/get-api-key` 301-redirects there), so it never fired. It's now demoted to
> **Secondary** and superseded by the event-based Sign-up action above.

## Phase 2 — Activation (first API key use) — shipped (code) + manual Ads setup

Truer "activated customer" signal. It happens **server-side** (an API call, no browser), so it
uses **offline conversion import via Google Ads scheduled upload**, keyed on the `gclid`
captured at sign-up. Google dedupes offline conversions by (Google Click ID, Conversion Name,
Conversion Time), so the endpoint emits a rolling window with a stable conversion time.

### Data flow (all in code)

1. **Capture** — `captureGclid()` persists `gclid`/`wbraid`/`gbraid` to `localStorage`
   (`rm_gclid`) on the `/get-key` page ([`lib/google-ads-conversion.ts`](../lib/google-ads-conversion.ts)).
2. **Persist** — on key creation, the client sends `gclid` in `POST /api/agent-keys`;
   `persistGclidIfVacant()` stores it (first-touch) in `agent_accounts.signup_attribution`
   jsonb under `gclid` / `gclid_at`. No schema change — `supabase/` is gitignored / governed
   in the private BWMACRO repo.
3. **Activate** — `validateApiKey()` ([`lib/agent/api-keys.ts`](../lib/agent/api-keys.ts))
   detects the first use of a key (prior `last_used_at` was null) and idempotently sets
   `signup_attribution.first_api_use_at` via `recordActivationIfFirstUse()`.
4. **Export** — `GET /api/internal/google-ads/offline-conversions`
   ([route](../app/api/internal/google-ads/offline-conversions/route.ts)) returns a Google Ads
   scheduled-upload CSV (Google Click ID, Conversion Name, Conversion Time, Value, Currency)
   for activated accounts in a rolling window (`?days=`, default 60). Conversion Name is
   **`Activation - first API use`** (must match the Ads action exactly).

### Env

Set a shared secret (Doppler → Vercel): **`GOOGLE_ADS_OFFLINE_UPLOAD_TOKEN`**.
The endpoint accepts it as `Authorization: Bearer <token>`, HTTP Basic auth password, or
`?token=<token>`. Verify after deploy:
`curl -u x:$GOOGLE_ADS_OFFLINE_UPLOAD_TOKEN https://riskmodels.app/api/internal/google-ads/offline-conversions`

### Manual Google Ads setup (requires account-owner action)

These two steps need a legal compliance attestation only the account owner can make, so they
are **not** automated:

1. **Create the offline conversion action.** Goals → Conversions → Create conversion action →
   **Conversions offline** → "Skip this step and set up a data source later" → check the
   **Customer data** compliance box → name it exactly **`Activation - first API use`**,
   category *Other* (or *Sign-up*), Count **One**, Value same-for-each **$1**, click-through
   window **90 days**. Leave it **Secondary** initially (observe), promote to Primary once
   activation volume builds.
2. **Create the scheduled upload.** Tools → Data manager (or Goals → Uploads) → Schedule →
   source **HTTPS**, URL = the endpoint above, auth = Basic (any username; password =
   `GOOGLE_ADS_OFFLINE_UPLOAD_TOKEN`), frequency **daily**, format **Conversions**.

### Verify

Make a test account, generate a key, then call any API endpoint with it → DB row gets
`signup_attribution.first_api_use_at`. The next scheduled upload (or a manual "Upload now")
ingests the row; the Activation conversion appears in Google Ads within a few hours.

### Bidding

Optimize on **Sign-up** early (volume, fast signal); add/promote **Activation** as volume
allows. Activation can lag days, so keep it Secondary until counts are meaningful.
