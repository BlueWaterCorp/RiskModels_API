# RiskModels_API — Developer Platform QA Report

**Date:** 2026-03-31
**Environment:** Production (https://riskmodels.app) & Local Repository

---

## 1. Summary of Results

| Check | Pass/Fail | Notes | URL or Route |
|-------|-----------|-------|--------------|
| **Static Pages** | Pass | All marketing/onboarding pages render correctly. | `/get-key`, `/api-reference`, `/quickstart`, `/docs/api` |
| **Redirects** | Pass (Fixed) | Legacy and canonical redirects verified. | `/examples`, `/docs`, `/api-docs`, `/documentation` |
| **Provisioning APIs** | Pass (Error) | 400 cases return correct schema; happy path not tested (no creds). | `POST /api/auth/provision-free`, `POST /api/auth/provision` |
| **OpenAPI Spec** | Pass | Spec is reachable and matches deployed routes. | `/openapi.json`, `/api-docs.html` |
| **Public API Auth** | Pass | Data endpoints correctly enforce 401 without keys. | `GET /api/metrics/NVDA` |
| **Repo Health** | Pass | Lint, Typecheck, and Build pass. | N/A |

---

## 2. Detailed Findings

### A. Static & Marketing Pages (Production)

Verified that the following paths return 200 OK and display the intended UI on `https://riskmodels.app`:

| Path | Purpose | Status |
|------|---------|--------|
| `/get-key` | Key issuance / onboarding UI | **200 OK** |
| `/api-reference` | Hosted API reference / OpenAPI entry | **200 OK** |
| `/quickstart` | CLI and SDK quickstart guide | **200 OK** |
| `/docs/api` | API Documentation | **200 OK** |
| `/pricing` | Pricing information | **200 OK** |
| `/legal` | Legal and disclosures | **200 OK** |
| `/account/usage` | User usage and API keys | **200 OK** |

### B. Redirects & Canonical URLs (Implemented Fixes)

The following redirects were verified or implemented in `next.config.mjs`:

| Source | Destination | Status |
|--------|-------------|--------|
| `/examples` | `/quickstart#code-examples` | **308 (Existing)** |
| `/docs` | `/docs/api` | **308 (Fixed)** |
| `/api-docs` | `/api-docs.html` | **308 (Fixed)** |
| `/documentation` | `/docs/api` | **308 (Fixed)** |

**Note:** Previously `/api-docs` and `/documentation` returned 404, and `/docs` returned 200 but was redundant with `/docs/api`.

### C. API Provisioning

Tested via `curl` against `https://riskmodels.app`:

*   **`POST /api/auth/provision-free`**:
    *   **Invalid Body:** Returns `400 Bad Request` with `{"error":"Invalid agent_name", ...}`.
    *   **Happy Path:** Not tested (requires Supabase service role access not available in this environment).
*   **`POST /api/auth/provision`**:
    *   **Missing Fields:** Returns `400 Bad Request` with `{"error":"Missing required fields", ...}`.

### D. OpenAPI / Schema

*   **`https://riskmodels.app/openapi.json`**: Reachable, returns 200 OK.
*   **`https://riskmodels.app/api-docs.html`**: Reachable, returns 200 OK.
*   **Version:** `3.0.0-agent`.
*   **Base URL in Spec:** `https://riskmodels.app/api`.

### E. Public API Auth Behavior

*   **`GET https://riskmodels.app/api/metrics/NVDA`**:
    *   **No Key:** Returns `401 Unauthorized` with instruction to provision a key.
    *   **Demo Key:** `rm_demo_mag7_...` also returns `401` for this endpoint (intended, as it's restricted).

---

## 3. Implemented Fixes in this PR

1.  **`next.config.mjs`**: Added permanent redirects for legacy paths:
    *   `/api-docs` → `/api-docs.html`
    *   `/documentation` → `/docs/api`
    *   `/docs` → `/docs/api`
2.  **OpenAPI Sync**: Regenerated `public/openapi.json` from `OPENAPI_SPEC.yaml` using `npm run build:openapi`.

---

## 4. Runbook: OAuth / Supabase Config

For reference, the following configuration is required for this application:

*   **Site URL:** `https://riskmodels.app`
*   **Redirect URL:** `https://riskmodels.app/auth/callback`
*   **Middleware Behavior:**
    *   Handles `?code=` on the root `/` and redirects to `/get-key?code=...` for client-side exchange.
    *   Handles session refresh on all matched routes.
*   **Callback Logic:**
    *   `app/auth/callback/route.ts` exchanges the code for a session and redirects to the `next` parameter (defaults to `/get-key`).
