# Google Ads conversion tracking

Account: **RiskModels.app** (Google Ads `849-116-0672`) · Google tag **`AW-18161098219`**
(loaded site-wide by [`components/GoogleAdsTag.tsx`](../components/GoogleAdsTag.tsx)).

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

## Phase 2 — Activation (first API key use) — planned

Truer "activated customer" signal, but it happens **server-side** (an API call), so it needs
**offline conversion import**, not a browser tag.

Groundwork already in place: `captureGclid()` in `lib/google-ads-conversion.ts` persists the
`gclid` / `wbraid` / `gbraid` to `localStorage` (`rm_gclid`) at landing.

To build:

1. Persist the captured `gclid` onto the account/user at sign-up (DB column).
2. Detect first key use server-side — `api_keys.last_used_at` transitions from `null`
   (already tracked).
3. Create an **offline (import)** conversion action "Activation — first API use" in Google Ads.
4. Upload conversions via the Google Ads API (or Enhanced Conversions for Leads by hashed
   email), keyed on the stored `gclid`, within the conversion window.
5. Optimize the campaign on Sign-up early (volume), shift toward Activation as volume allows.
