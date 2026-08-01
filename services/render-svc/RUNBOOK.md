# Deployment Runbook — riskmodels-render-svc

End-to-end Cloud Run deployment for the render service. Assumes you have
`gcloud` CLI installed, a GCP project, and billing enabled.

This runbook is for the **operator** (you). It documents what *I cannot do*
because it requires interactive auth and billing decisions.

---

## Prerequisites

- GCP project (e.g. `riskmodels-prod`)
- Billing enabled
- `gcloud` CLI authenticated against that project: `gcloud auth login`
- `gcloud config set project riskmodels-prod`
- The canonical-artifact GCS bucket exists (`gs://rm_api_data/`) with at
  least one P1 canonical JSON for smoke-testing

---

## One-time setup

### 1. Enable required APIs

```bash
gcloud services enable \
    run.googleapis.com \
    artifactregistry.googleapis.com \
    cloudbuild.googleapis.com
```

### 2. Create an Artifact Registry repository for the container

```bash
gcloud artifacts repositories create render-svc \
    --repository-format=docker \
    --location=us-central1 \
    --description="riskmodels-render-svc container images"
```

### 3. Create a service account for the render service

The service account needs read/write on the canonical-artifact bucket.

```bash
gcloud iam service-accounts create render-svc \
    --display-name="riskmodels-render-svc"

gcloud storage buckets add-iam-policy-binding gs://rm_api_data \
    --member="serviceAccount:render-svc@$(gcloud config get-value project).iam.gserviceaccount.com" \
    --role="roles/storage.objectAdmin"
```

(`storage.objectAdmin` covers read + write + delete. If the service should
never delete, use `storage.objectCreator` + `storage.objectViewer` instead.)

---

## Build the container

The Dockerfile expects the `riskmodels-py` SDK source at a sibling path during
build. Use a buildable context that includes both:

```bash
# From the RiskModels_API repo root
cd "$(git rev-parse --show-toplevel)"

# Build with the SDK as additional context. The Dockerfile references
# --from=sdk-context for the SDK source.
gcloud builds submit \
    --tag us-central1-docker.pkg.dev/$(gcloud config get-value project)/render-svc/render-svc:latest \
    --config=services/render-svc/cloudbuild.yaml \
    .
```

If you don't have a `cloudbuild.yaml` yet, the simplest local build is:

```bash
cd services/render-svc

# Stage the SDK alongside the build context.
cp -R ../../sdk ./_sdk_build

# Build locally (Docker required).
docker build \
    --build-context sdk-context=./_sdk_build \
    -t us-central1-docker.pkg.dev/$(gcloud config get-value project)/render-svc/render-svc:latest \
    .

# Clean up the staged SDK.
rm -rf ./_sdk_build

# Push to Artifact Registry.
gcloud auth configure-docker us-central1-docker.pkg.dev
docker push us-central1-docker.pkg.dev/$(gcloud config get-value project)/render-svc/render-svc:latest
```

A proper `cloudbuild.yaml` that automates the staging step is a follow-up;
manual build works for the first deploy.

---

## Deploy to Cloud Run

```bash
gcloud run deploy render-svc \
    --image us-central1-docker.pkg.dev/$(gcloud config get-value project)/render-svc/render-svc:latest \
    --region us-central1 \
    --service-account render-svc@$(gcloud config get-value project).iam.gserviceaccount.com \
    --allow-unauthenticated=false \
    --min-instances=1 \
    --max-instances=10 \
    --memory=2Gi \
    --cpu=2 \
    --timeout=60s \
    --set-env-vars=RENDER_SVC_BUCKET=rm_api_data,RENDER_SVC_PREFIX=snapshots,RENDER_SVC_LOG_LEVEL=INFO \
    --set-secrets=RISKMODELS_API_KEY=render-svc-riskmodels-api-key:latest,RENDER_SVC_SUBJECT_SALT=render-svc-subject-salt:latest,SUPABASE_URL=render-svc-supabase-url:latest,SUPABASE_SERVICE_ROLE_KEY=render-svc-supabase-service-role-key:latest
```

> **`--set-secrets` replaces the whole secret set — list every one.** Naming
> only the new pair silently drops `RISKMODELS_API_KEY` and
> `RENDER_SVC_SUBJECT_SALT`. To add one secret to a running service without
> touching the rest, use `gcloud run services update --update-secrets=…`
> instead.

> **`SUPABASE_*` is not optional, and the key format matters.** Without usable
> credentials, fund renders return **HTTP 200 carrying an empty chart** — raw
> `BW-BBG…` labels and every risk share `null` — because
> `enrich_fund_data_with_supabase` soft-fails to `[]`. That soft-fail is
> correct for pip consumers and wrong for a service: nothing errors, so
> nothing alerts.
>
> Audited 2026-08-01: prod had been running with no Supabase credentials since
> deploy, so the P.1 fix (moving the enricher into the public SDK) had never
> taken effect in production. Fixed the same day.
>
> **Take the key from Doppler `erm3/prd`, not `.env.local`.** The local file
> still holds a legacy `service_role` JWT (`eyJ…`); Supabase disabled legacy
> anon/service_role keys on **2026-07-06** and they now 401 — which the SDK
> soft-fails into exactly the blank chart above. The current key is
> `sb_secret_…`. `load_from_env` warns when it sees a JWT for this reason.
>
> ```bash
> doppler secrets get SUPABASE_SERVICE_ROLE_KEY -p erm3 -c prd --plain \
>   | gcloud secrets versions add render-svc-supabase-service-role-key --data-file=-
> gcloud run services update render-svc --region us-central1 \
>   --update-secrets=SUPABASE_URL=render-svc-supabase-url:latest,SUPABASE_SERVICE_ROLE_KEY=render-svc-supabase-service-role-key:latest
> ```
>
> Verify by rendering, not by reading config — a present key can still be a
> dead one. Pass a `top_n` that is not already cached, or the GCS render cache
> will hand back the pre-fix artifact and everything will look unchanged:
>
> ```bash
> curl -s -X POST "$URL/artifacts/render" -H "Authorization: Bearer $TOKEN" \
>   -H 'Content-Type: application/json' \
>   -d '{"slug":"top_holdings_erm_stacked","version":"v1",
>        "subject_id":"BW-FUND-S000004310","as_of":"latest","format":"json",
>        "params":{"top_n":6}}'
> # rows[].label must be tickers (NVDA, AAPL…), not BW-BBG…,
> # and decomposition_available must be true.
> ```
>
> `/readyz` also reports `holdings_enrichment`, but it does not fail readiness:
> filer, cohort and stock subjects are unaffected, and failing the probe would
> take the service down to report a partial gap.
>
> **`client_portfolio` is not affected by any of this.**
> `holdings_from_client_portfolio` is a pass-through — it reads `l3_mkt_er` /
> `l3_sec_er` / `l3_sub_er` / `l3_res_er` off the supplied positions and looks
> nothing up. A payload carrying only `ticker`+`weight` renders null segments
> because that is the contract, not because enrichment is broken.

**Why these settings:**

- `--allow-unauthenticated=false` — the service is internal; only the Vercel
  front-end (or a service account) should call it. Vercel attaches an
  OIDC token to the call.
- `--min-instances=1` — keeps one instance always warm. A scale-to-zero
  cold start is ~2-3s (Python + matplotlib container), which blows the
  workspace's <5s first-artifact budget. One warm instance removes that
  penalty; the cost is one always-on Cloud Run instance (small at this
  CPU/memory). To apply to a running service without a full redeploy:
  `gcloud run services update render-svc --region us-central1 --min-instances=1`.
- `--memory=2Gi --cpu=2` — matplotlib + numpy + xarray comfortably fit;
  PDF render uses ~600 MB peak.
- `--timeout=60s` — render-from-canonical-JSON completes in <3s warm; the
  60s timeout covers cold starts plus large F1 portfolios.

---

## Wire the Vercel front-end

The Next.js API route on Vercel (`riskmodels.net` / `.app`) needs to:

1. Resolve the canonical artifact path from the user's request
2. Try a signed-URL HEAD against GCS first (the cache-hit fast path)
3. If 404, call the Cloud Run `/render` endpoint with an OIDC token

Sketch (`app/api/snapshot/[composition]/[id]/route.ts`):

```ts
import { GoogleAuth } from "google-auth-library";

export async function GET(req: Request, { params }) {
  const { composition, id } = params;
  const asOf = new URL(req.url).searchParams.get("as_of") ?? "latest";

  // 1. Try GCS direct first (cache-hit fast path)
  const path = `snapshots/${composition}/${asOf.slice(0, 7)}/${id}.pdf`;
  const cached = await fetch(`https://storage.googleapis.com/rm_api_data/${path}`);
  if (cached.ok) {
    return new Response(cached.body, {
      headers: { "Content-Type": "application/pdf" },
    });
  }

  // 2. Fall back to Cloud Run live render
  const auth = new GoogleAuth();
  const client = await auth.getIdTokenClient(process.env.RENDER_SVC_URL!);
  const rendered = await client.request({
    url: `${process.env.RENDER_SVC_URL}/render`,
    method: "POST",
    data: { composition, identifier: id, as_of: asOf, format: "pdf" },
  });
  return new Response(rendered.data, {
    headers: { "Content-Type": "application/pdf" },
  });
}
```

`RENDER_SVC_URL` is set on the Vercel project env to the Cloud Run service
URL (`https://render-svc-XXXXX-uc.a.run.app`).

---

## Verify deployment

```bash
SERVICE_URL=$(gcloud run services describe render-svc --region us-central1 --format='value(status.url)')

# Liveness
curl $SERVICE_URL/healthz
# {"status":"ok"}

# Readiness (validates bucket access)
gcloud auth print-identity-token | xargs -I {} curl \
    -H "Authorization: Bearer {}" \
    $SERVICE_URL/readyz
# {"status":"ready","bucket":"rm_api_data"}

# Render an existing P1 snapshot
gcloud auth print-identity-token | xargs -I {} curl \
    -H "Authorization: Bearer {}" \
    -H "Content-Type: application/json" \
    -X POST $SERVICE_URL/render \
    -d '{"composition":"p1","identifier":"NVDA","as_of":"2026-05-09","format":"png"}' \
    -o /tmp/nvda.png

file /tmp/nvda.png
# /tmp/nvda.png: PNG image data, ...
```

---

## Stock-panel API key (O.6 live decompose loader)

The stock panel route (`GET /api/snapshot/stock/{id}/panels/{slug}`) needs
`RISKMODELS_API_KEY` in the render-svc environment to make its internal
`POST /api/decompose` call (`render_svc/artifacts.py::_fetch_decompose`).
Without it the route 503s with "RISKMODELS_API_KEY not configured".

Wired 2026-07-14 (revision `render-svc-00021-gkn`):

- **SSOT:** Doppler `erm3/prd` → `RENDER_SVC_RISKMODELS_API_KEY`
- **Runtime:** GCP Secret Manager secret `render-svc-riskmodels-api-key`,
  mounted on the service as env var `RISKMODELS_API_KEY`
  (`--update-secrets RISKMODELS_API_KEY=render-svc-riskmodels-api-key:latest`);
  `render-svc@` SA has `secretmanager.secretAccessor` on it.

**Rotation:**

```bash
doppler secrets set RENDER_SVC_RISKMODELS_API_KEY --project erm3 --config prd   # update SSOT
doppler secrets get RENDER_SVC_RISKMODELS_API_KEY --project erm3 --config prd --plain \
  | gcloud secrets versions add render-svc-riskmodels-api-key --data-file=-
gcloud run services update render-svc --region us-central1 \
  --update-secrets RISKMODELS_API_KEY=render-svc-riskmodels-api-key:latest      # new revision picks up :latest
```

Current value is an operator key; replace with a dedicated service key when
one is minted (tracked under MASTER_BACKLOG O.6).

---

## Portfolio subject-id salt (`RENDER_SVC_SUBJECT_SALT`)

`client_portfolio` subjects are addressed as `BW-PORTFOLIO-<digest>`, where the
digest comes from `render_svc/artifacts.py::_payload_hash`. Derived from content
alone, the digest is reproducible by anyone holding the same positions, so the
id cannot be treated as opaque. The salt makes it opaque while preserving
render-once dedup: the same portfolio still resolves to one cache key.

Unset, `_payload_hash` falls back to its previous form, so the service starts
and existing cached objects keep resolving. Set it.

- **SSOT:** Doppler `erm3/prd` → `RENDER_SVC_SUBJECT_SALT`
- **Runtime:** GCP Secret Manager secret `render-svc-subject-salt`, mounted as
  env var `RENDER_SVC_SUBJECT_SALT`

```bash
# Mint (once). Any high-entropy value; it is never transmitted or displayed.
openssl rand -hex 32 | doppler secrets set RENDER_SVC_SUBJECT_SALT \
  --project erm3 --config prd
doppler secrets get RENDER_SVC_SUBJECT_SALT --project erm3 --config prd --plain \
  | gcloud secrets create render-svc-subject-salt --data-file=-
gcloud run services update render-svc --region us-central1 \
  --update-secrets RENDER_SVC_SUBJECT_SALT=render-svc-subject-salt:latest
```

**Setting or rotating this re-keys every `client_portfolio` artifact.** Objects
under the old digest are orphaned and the next request for each re-renders.
That is a cost and cache-occupancy event, not a correctness one — no user sees
a wrong artifact. Set it before any consumer starts persisting the subject id,
so no stored reference is invalidated. Orphaned objects under
`gs://rm_api_data/snapshots/artifacts/*/BW-PORTFOLIO-*/` can be swept
separately; nothing reads them once the salt changes.

Rotation is otherwise not routine: the salt is not a credential and holding it
grants no access, so rotate only if the value itself is disclosed.

---

## Monitoring + rollback

- **Logs:** Cloud Run console → Logs (or `gcloud run services logs tail render-svc`)
- **Metrics:** Cloud Run automatically exposes request count, latency, p95.
  Set an alert on `request_latencies > 10s` p95 — that's the cold-start +
  cache-miss path; if it stays high, investigate.
- **Rollback:** Cloud Run keeps revisions. To revert:
  ```bash
  gcloud run services update-traffic render-svc --to-revisions=PREVIOUS_REVISION=100 --region us-central1
  ```

---

## Post-deploy follow-ups (not blocking)

1. **`cloudbuild.yaml`** to automate the SDK staging during build.
2. **CI/CD:** GitHub Actions on push to `main` builds + deploys to a
   staging Cloud Run service.
3. **Custom domain:** map `render.riskmodels.app` to the Cloud Run service
   if you want a stable URL the Vercel side hardcodes.
4. **VPC connector** if the service ever needs to reach internal-only
   resources (Supabase via private IP, etc.). Not needed for Phase 1.
5. **Phase 2 — cache-miss live render** depends on the FundData reader
   promotion (tracker task #11).

---

## Phase 1B — artifact registry endpoint ops checklist

After PRs [#68](https://github.com/BlueWaterCorp/RiskModels_API/pull/68)
+ [#70](https://github.com/BlueWaterCorp/RiskModels_API/pull/70) land
(Dockerfile multi-repo build + `POST /artifacts/render` endpoint), the
artifact registry is live in code but **not deployed** until the four
steps below complete. They each need interactive auth and can't run from
a Claude session.

Cross-repo dependency map: parent SSOT is
`BWMACRO/docs/architecture/intelligence_runtime/ARTIFACT_REGISTRY_PHASE_1B_PLAN.md`.
Workspace consumer is `Risk_Models` PRs #82 (proxy + table prop) + #83
(visible preview panel).

### 1. Create the Secret Manager secret with a BWMACRO read token

The Dockerfile clones BWMACRO into the build context at `bwmacro-src/` so
`pip install --no-deps /tmp/bwmacro` can install the artifact subtree.
Cloud Build needs a GitHub access token to do the clone (BWMACRO is
private).

Generate a PAT (or GitHub App installation token) with `repo:read` scope
limited to `BlueWaterCorp/BWMACRO`, then store it:

```bash
echo -n "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxx" | \
  gcloud secrets create github-bwmacro-read \
    --replication-policy="automatic" \
    --data-file=-
```

Grant the Cloud Build service account access:

```bash
PROJECT_NUMBER=$(gcloud projects describe "$(gcloud config get-value project)" \
  --format='value(projectNumber)')
gcloud secrets add-iam-policy-binding github-bwmacro-read \
  --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### 2. Update the render-svc Cloud Build trigger to inject the token

The current `cloudbuild.yaml` expects `_BWMACRO_GIT_TOKEN` as a build
substitution; the prep step bails loudly if it's empty. Wire the secret
into the trigger so the substitution gets populated automatically on
each build (Console: Cloud Build → Triggers → `render-svc-deploy` →
Edit → Substitutions → `_BWMACRO_GIT_TOKEN` mapped to
`projects/<PROJECT_NUMBER>/secrets/github-bwmacro-read/versions/latest`).

For ad-hoc CLI builds (no trigger), pass the token at submit time:

```bash
TOKEN=$(gcloud secrets versions access latest --secret=github-bwmacro-read)
gcloud builds submit --config services/render-svc/cloudbuild.yaml \
  --substitutions=_BWMACRO_GIT_TOKEN="${TOKEN}" .
```

### 3. Deploy the artifact-registry-aware image

Once the trigger is wired (or you run an ad-hoc build), the next push to
`main` rebuilds the image with the bwmacro artifact subtree. The
Dockerfile's **import-firewall smoke (§5)** catches drift at BUILD time:
if a future refactor reintroduces `bwmacro.snapshots.funds._ai_insight`
/ `_data` / `supabase` at module scope, the build fails with the
offending module listed instead of producing a bloated image. Verify
the smoke output in the Cloud Build logs:

```
=== Step "build-image" ===
...
artifact import firewall OK
```

After the build, deploy the new revision:

```bash
gcloud run services update render-svc \
  --image=us-central1-docker.pkg.dev/$(gcloud config get-value project)/cloud-run-source-deploy/render-svc:latest \
  --region=us-central1
```

Smoke the endpoint (the Cloud Run URL is what feeds `RENDER_SVC_URL`
below):

```bash
RENDER_URL=$(gcloud run services describe render-svc \
  --region=us-central1 --format='value(status.url)')

curl -X POST "${RENDER_URL}/artifacts/render" \
  -H 'Content-Type: application/json' \
  -d '{
    "slug": "top_holdings_erm_stacked",
    "version": "v1",
    "subject_id": "BW-FUND-S000004563",
    "as_of": "latest",
    "format": "json"
  }' \
  -i | head -40
```

Expected:
- `HTTP/2 200` with `X-Artifact-Resolved-As-Of: 2025-MM-DD`
- `X-Artifact-GCS-Path: gs://rm_api_public/snapshots/artifacts/top_holdings_erm_stacked@v1/BW-FUND-S000004563/2025-MM-DD.json`
- JSON body matching the `TopHoldingsErmStackedV1` shape in the SDK.

### 4. Wire RENDER_SVC_URL on the Risk_Models Vercel project

The Next.js proxy route (`riskmodels_net/src/app/api/artifacts/render/route.ts`)
returns 503 with a friendly message when `RENDER_SVC_URL` is unset,
so the workspace preview panel (Risk_Models PR #83) degrades cleanly.
To activate it:

```bash
# Vercel CLI from riskmodels_net/:
vercel env add RENDER_SVC_URL production
# paste the Cloud Run URL from step 3
vercel env add RENDER_SVC_URL preview   # if you want preview deploys to use it too
vercel deploy --prod                    # or push a commit to trigger the build
```

Or via the Vercel UI: Project Settings → Environment Variables → add
`RENDER_SVC_URL = <CLOUD_RUN_URL>` for Production (and Preview if desired).

After redeploy, the AHA panel's "Artifact Registry · live preview"
section should render AGTHX's top holdings within ~2 seconds of the
snapshot landing.

### Phase 2 follow-ons (not in this checklist)

- Postgres `artifact_registry` UPSERT (Dagster reconciliation job).
- `FundData` arbitrary `as_of` threaded through `get_data_for_f1`.
- Widen `top_holdings_erm_stacked@v1` to `client_portfolio` + add adapter
  + extend endpoint with `subject_payload` — at that point the workspace
  preview goes away and the user's own positions render via the artifact path.
- Nightly byte-compare Dagster job against real AGTHX zarr.
