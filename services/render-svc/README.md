# riskmodels-render-svc

Cloud Run render service for canonical-snapshot artifacts. Re-renders canonical
JSON (P1, F1, C1) into PDF / PNG / JSON formats on demand. Cache-hit serving
path; Phase 2 will add cache-miss live render from raw zarr data.

Reads the canonical artifact at:
```
gs://{bucket}/{prefix}/{composition}/{YYYY-MM}/{identifier}.json
```
and writes the rendered format alongside it.

Architecture: `BWMACRO/docs/architecture/GCS_PRERENDER_OPERATIONS.md`.

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/render` | Re-render the canonical artifact in the requested format |
| `GET` | `/healthz` | Liveness probe |
| `GET` | `/readyz` | Readiness probe (verifies bucket access) |

### `POST /render`

Request:
```json
{
  "composition": "p1" | "f1" | "c1",
  "identifier":  "NVDA",
  "as_of":       "2026-05-09",
  "format":      "json" | "pdf" | "png"
}
```

Response: raw bytes with the matching `Content-Type`. Headers include:
- `X-Canonical-Path` — `gs://...` URI of the canonical JSON
- `X-Cache-Written` — `1` if the rendered format was written back to GCS

Status codes:
- `200` — rendered (cache-hit)
- `404` — canonical JSON not found at the resolved path
- `422` — canonical loaded but failed the fast-subset contract gate
- `400` — bad request / unsupported format

---

## Configuration

All from environment variables:

| Var | Default | Purpose |
|---|---|---|
| `RENDER_SVC_BUCKET` | `rm_api_data` | GCS bucket holding canonical artifacts |
| `RENDER_SVC_PREFIX` | `snapshots` | Path prefix inside the bucket |
| `RENDER_SVC_GENERATED_UTC` | (unset) | Anchored timestamp for re-render determinism. Production: trading-day close in UTC |
| `RENDER_SVC_LOG_LEVEL` | `INFO` | Standard Python log level |
| `RENDER_SVC_PERSIST_RENDERS` | `1` | Whether to write rendered formats back to GCS (`0` for tests) |

---

## Local development

```bash
cd services/render-svc
pip install -e ".[dev]"
RENDER_SVC_PERSIST_RENDERS=0 \
RENDER_SVC_BUCKET=test-bucket \
uvicorn render_svc.app:app --reload --port 8080

# In another shell, smoke-test the readiness probe (will 503 unless you have GCS creds):
curl localhost:8080/healthz
```

Run the test suite:

```bash
pytest tests/ -p no:ethereum -q
```

8 tests cover the cache-hit path (P1 JSON / PDF / PNG round-trip via the FakeStore),
deterministic re-render, gate failure on bogus ontology version, cache-miss 404,
and path-resolution edge cases.

---

## Deployment

See `RUNBOOK.md` for the full Cloud Run deployment sequence.

---

## Phase 2 (not yet shipped)

- Cache-miss live render: fetch raw zarr from GCS, compute canonical from
  scratch via `riskmodels.snapshots.from_components` / `from_fund_components`,
  write canonical JSON + rendered formats to GCS in one transaction.
- Requires the FundData reader promotion (RiskModels_API tracker task #11) to
  finish before F1 cache-miss is feasible without `bwmacro.*` imports.
