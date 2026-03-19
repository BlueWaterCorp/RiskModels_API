# ERM3 Zarr API Migration Plan: Static-to-Dynamic Gateway

## Overview
This plan transitions the RiskModels v3.0.0 architecture from bundling Zarr data in Vercel (static) to a "Redirect-based Gateway." This bypasses Vercel’s 4.5MB payload limit and 500MB deployment limit while maintaining billing/auth via your existing middleware.

---

## Phase 1: Infrastructure & Permissions
**Goal:** Grant the Vercel Service Account the ability to sign URLs for private GCP buckets.

### Prompt 1: IAM Setup
> "I need to update the IAM permissions for our Vercel service account to support GCS Signed URLs for Zarr delivery. 
> 1. Identify the service account used by Vercel (look in `.env` or GCP credentials).
> 2. Write a `gcloud` command to grant it `roles/storage.objectViewer` on our private risk-data bucket.
> 3. Write a `gcloud` command to grant it `roles/iam.serviceAccountTokenCreator` on its own service account. This is required for the API to generate V4 Signed URLs."

---

## Phase 2: Backend Pipeline (ERM3 / Dagster)
**Goal:** Ensure Zarr data is "API-ready" by consolidating metadata and moving the sync target.

### Prompt 2: Dagster Asset Optimization
> "Modify the ERM3 export logic in the `risk_models` repo to optimize Zarr for API delivery.
> 1. In the final export asset, ensure `zarr.consolidate_metadata(store)` is called after all writes are complete.
> 2. Update the sync logic to push to a private GCS bucket path (e.g., `gs://risk-models-private/zarr/v3/`) instead of the Vercel static folder.
> 3. Add a step to verify the `.zmetadata` file exists at the root of the GCS bucket after sync.
> 4. Ensure the local build no longer includes these Zarr folders in the Vercel deployment bundle to keep the slug size small."

---

## Phase 3: API Gateway (risk_models / FastAPI)
**Goal:** Create the "Traffic Controller" route that handles billing and redirects users to GCP.

### Prompt 3: The Zarr Redirect Route
> "Add a new Zarr delivery endpoint to our FastAPI router in the `risk_models` repo.
> 1. Create a GET route at `/api/v3/zarr/{store_name}/{path:path}`.
> 2. Integrate it with our existing `billing-middleware` (refer to PHASE_1_COMPLETE.md) so each request logs a cost of $0.003 - $0.005.
> 3. Implement the following logic:
>    - Initialize a `google-cloud-storage` client using our environment credentials.
>    - Map `{store_name}` to our private GCS bucket name.
>    - Map `{path}` to the internal blob path.
>    - Generate a V4 Signed URL with a 5-minute expiration using the service account's identity.
> 4. Return a `fastapi.responses.RedirectResponse(url=signed_url)`.
> 5. Special Case: Ensure that if `{path}` is `.zmetadata`, the billing is only applied once per session or at a lower rate, as Zarr clients hit this file first."

---

## Phase 4: Public Documentation (riskmodels_api)
**Goal:** Update the public-facing repo to teach users how to connect.

### Prompt 4: Usage Documentation
> "Update the README and example notebooks in the `riskmodels_api` repo to show how to consume the new Zarr API.
> 1. Provide a Python example using `xarray` and `zarr`.
> 2. Show how to initialize the store: 
>    `fsspec.get_mapper('https://your-api.com/api/v3/zarr/risk_cube', headers={'X-API-KEY': 'your_key'})`.
> 3. Explain that the API uses HTTP 302 redirects to serve data securely from GCP, allowing for high-performance slicing of massive datasets."

---

## Technical Checklist
- [ ] GCS Bucket set to **Private** (No public access).
- [ ] Vercel Service Account has `Token Creator` role.
- [ ] `zmetadata` is consolidated in v2 format.
- [ ] `X-API-Cost-USD` header is correctly injected by the redirect route for MCP/Agent monitoring.
