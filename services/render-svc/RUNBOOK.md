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
# From the repo root
cd /Users/conradgann/BW_Code/RiskModels_API

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
    --min-instances=0 \
    --max-instances=10 \
    --memory=2Gi \
    --cpu=2 \
    --timeout=60s \
    --set-env-vars=RENDER_SVC_BUCKET=rm_api_data,RENDER_SVC_PREFIX=snapshots,RENDER_SVC_LOG_LEVEL=INFO
```

**Why these settings:**

- `--allow-unauthenticated=false` — the service is internal; only the Vercel
  front-end (or a service account) should call it. Vercel attaches an
  OIDC token to the call.
- `--min-instances=0` — scales to zero between requests; cold start ~2-3s
  for the first request after idle. Acceptable for institutional use.
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
