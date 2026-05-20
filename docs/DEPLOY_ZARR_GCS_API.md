# What you need to do: API + GCS Zarr

The API reads history from **Zarr files in Google Cloud Storage**. Your **ERM3 pipeline** already writes those files. You only need to give the **RiskModels API** (the Next.js app on Vercel or similar) **read access** and the right **environment variables**.

**You do not** copy ERM3’s `.env` to Vercel by hand unless those same variables are also defined for the API project. The **ERM3 VM** and **Vercel** are two different runtimes.

---

## Part A — Google Cloud (one-time, `gcloud` CLI)

Use the [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) (`gcloud`). Log in and pick the project that **owns the zarr bucket** (same project ERM3 uses for uploads, if applicable).

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

Set shell variables (adjust names to match your org). Use **one line at a time** when pasting into **zsh** so lines are not merged.

- `PROJECT_ID` — same as `gcloud config get-value project`.
- `BUCKET` — GCS bucket name only (no `gs://`).
- `KEY_FILE` — where the JSON key will be written; keep out of git.

```bash
export PROJECT_ID="YOUR_PROJECT_ID"
export BUCKET="rm_api_data"
export SA_ID="riskmodels-api-zarr-read"
export SA_EMAIL="${SA_ID}@${PROJECT_ID}.iam.gserviceaccount.com"
export KEY_FILE="${HOME}/.secrets/${SA_ID}.json"
mkdir -p "${HOME}/.secrets"
```

**1. Confirm the bucket and zarr prefix exist**

```bash
gcloud storage ls "gs://${BUCKET}/" | head -20
# Expect folders like eodhd/ds_daily.zarr/ ... (see ERM3 docs/config/GCS_PATH_PREFIX.md)
```

**2. Create the service account**

```bash
gcloud iam service-accounts create "${SA_ID}" \
  --project="${PROJECT_ID}" \
  --display-name="RiskModels API Zarr read-only"
```

**3. Grant read-only access on that bucket only**

`roles/storage.objectViewer` allows `storage.objects.get` and list; it does **not** allow writes.

```bash
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/storage.objectViewer" \
  --project="${PROJECT_ID}"
```

**4. Create a JSON key (download once)**

```bash
gcloud iam service-accounts keys create "${KEY_FILE}" \
  --iam-account="${SA_EMAIL}" \
  --project="${PROJECT_ID}"
```

Use the contents of **`KEY_FILE`** as **`GCP_SERVICE_ACCOUNT_JSON`** in Part B (paste into Doppler / Vercel). **Do not** commit `KEY_FILE` or push it to git.

**Optional checks**

```bash
# IAM on the bucket (verify binding)
gcloud storage buckets get-iam-policy "gs://${BUCKET}" --project="${PROJECT_ID}" \
  | grep -F "${SA_EMAIL}" || true

# Act-as check from your user (does not prove SA works on Vercel; use Part C smoke test)
gcloud auth application-default print-access-token >/dev/null && echo "ADC OK"
```

**If `gcloud storage buckets add-iam-policy-binding` is not available** (older SDK), use `gsutil`:

```bash
gsutil iam ch "serviceAccount:${SA_EMAIL}:objectViewer" "gs://${BUCKET}"
```

---

## Part B — Put secrets where the API runs (Doppler → Vercel)

The Next.js app must see credentials **in Vercel** (or whatever hosts `riskmodels.app`).

### B1. Add secrets with the Doppler CLI

Install the [Doppler CLI](https://docs.doppler.com/docs/install-cli) and log in once:

```bash
doppler login
```

This repo’s sync script defaults to **project `erm3`** and config **`prd`** (override with `DOPPLER_PROJECT` / `DOPPLER_CONFIG` if yours differ). Set **`GCP_SERVICE_ACCOUNT_JSON`** from the key file you created in Part A (`KEY_FILE`):

```bash
# Use the same PROJECT/CONFIG as scripts/doppler-sync-to-vercel.sh (defaults: erm3 / prd)
export DOPPLER_PROJECT="${DOPPLER_PROJECT:-erm3}"
export DOPPLER_CONFIG="${DOPPLER_CONFIG:-prd}"

# Pipe the JSON into Doppler (recommended for multiline JSON)
cat "$KEY_FILE" | doppler secrets set GCP_SERVICE_ACCOUNT_JSON \
  -p "$DOPPLER_PROJECT" \
  -c "$DOPPLER_CONFIG"
```

Optional overrides (skip if you use code defaults in `lib/zarr-config.ts`):

```bash
doppler secrets set ZARR_GCS_PREFIX="rm_api_data/eodhd" -p "$DOPPLER_PROJECT" -c "$DOPPLER_CONFIG"
doppler secrets set ZARR_FACTOR_SET_ID="SPY_uni_mc_3000" -p "$DOPPLER_PROJECT" -c "$DOPPLER_CONFIG"
```

Optional Upstash (only if you use shared Redis cache):

```bash
doppler secrets set UPSTASH_REDIS_REST_URL="https://..." -p "$DOPPLER_PROJECT" -c "$DOPPLER_CONFIG"
doppler secrets set UPSTASH_REDIS_REST_TOKEN="..." -p "$DOPPLER_PROJECT" -c "$DOPPLER_CONFIG"
```

Verify the keys exist (values are masked in CLI output):

```bash
doppler secrets -p "$DOPPLER_PROJECT" -c "$DOPPLER_CONFIG"
```

**Allowlist:** Keys are only pushed to Vercel if they appear in [`scripts/doppler-vercel-allowlist.txt`](../scripts/doppler-vercel-allowlist.txt). Ensure **`GCP_SERVICE_ACCOUNT_JSON`** (and any optional `ZARR_*` / Upstash names you set) are listed there.

**Push to Vercel** from the **RiskModels_API** repo root (after `npx vercel link` if needed):

```bash
cd /path/to/RiskModels_API
DOPPLER_PROJECT=erm3 DOPPLER_CONFIG=prd VERCEL_ENVS=production npm run vercel:sync-env:doppler
```

Use `VERCEL_ENVS=production,preview` if Preview should read Zarr too. Confirm in Vercel → **Settings → Environment Variables**, then **redeploy**.

### B2. Credentials (pick one)

The reader uses `@google-cloud/storage`. Supported setups:

| Where the API runs | What to set |
|--------------------|-------------|
| **Vercel / Doppler (recommended)** | **`GCP_SERVICE_ACCOUNT_JSON`** — the **entire** service account JSON as one string (same content as the file Google lets you download). In Doppler, paste multiline JSON; sync pushes it to Vercel. |
| **Laptop** | Either **`GCP_SERVICE_ACCOUNT_JSON`** as above, **or** `GOOGLE_APPLICATION_CREDENTIALS` = absolute path to the `.json` file in `.env.local`. |
| **VM / Docker** | Same as laptop: env JSON **or** `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json`. |

If **`GCP_SERVICE_ACCOUNT_JSON`** is set, it wins over default ADC. If neither JSON nor a valid ADC path exists, GCS calls fail until you fix Part B.

Optional (not required for Zarr to work):

| Variable | When to set | Default if unset |
|----------|-------------|-------------------|
| `ZARR_GCS_PREFIX` | Bucket or folder differs from production standard | `rm_api_data/eodhd` (see `lib/zarr-config.ts`) |
| `ZARR_FACTOR_SET_ID` | Your zarr files use a different suffix | `SPY_uni_mc_3000` |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | You want shared Redis cache across instances | Cache falls back to in-memory per instance |

---

## Part C — Deploy and check

1. **Merge / push** the branch that triggers your Vercel production deploy.  
2. **Smoke test** (must send a real API key):

   ```bash
   curl -sS "https://riskmodels.app/api/ticker-returns?ticker=NVDA&years=1" \
     -H "Authorization: Bearer YOUR_API_KEY" | head -c 2000
   ```

   In the JSON, look for `"_metadata"` → `"data_source":"zarr"` when GCS reads work.

3. **If `data_source` is missing or requests 500**  
   - Vercel → deployment → **Functions** logs → search `[zarr-internal]`.  
   - Confirm **`GCP_SERVICE_ACCOUNT_JSON`** exists on **Production** in Vercel (not only in ERM3’s `.env`).  
   - Confirm the JSON is valid (starts with `{`, includes `"type": "service_account"`).

---

## Short “do this in order” list

1. **GCP:** Run **Part A** (`gcloud`: create SA → `add-iam-policy-binding` / `gsutil iam ch` → `keys create`).  
2. **Doppler:** Create secret **`GCP_SERVICE_ACCOUNT_JSON`** = paste full JSON → add name to Vercel allowlist if needed → run `npm run vercel:sync-env:doppler` (or your team’s sync).  
3. **Optional:** `ZARR_GCS_PREFIX` / `ZARR_FACTOR_SET_ID` only if you do not use defaults (`rm_api_data/eodhd`, `SPY_uni_mc_3000`).  
4. **Deploy** RiskModels_API → run the **curl** smoke test above.

---

## Related docs

| Topic | File |
|--------|------|
| Why Zarr vs Supabase | [`API_HISTORY_SUPABASE_AND_ZARR.md`](./API_HISTORY_SUPABASE_AND_ZARR.md) |
| `_metadata` fields | [`RESPONSE_METADATA.md`](../RESPONSE_METADATA.md) |
| ERM3 bucket layout | ERM3 `docs/config/GCS_PATH_PREFIX.md` |
