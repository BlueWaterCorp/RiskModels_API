# API reliability, contract, and documentation — execution brief

## Purpose and audience

This document is an **actionable cross-functional brief** for:

- **Engineering** — fix deployed API behavior, timeouts, and error bodies.
- **SRE / on-call** — triage with reproducible evidence; correlate logs/traces (this doc is **not** a runbook).
- **Technical writing** — align OpenAPI, interactive reference, and public MDX with production.

**Scope:** Production behavior at `https://riskmodels.net/api` (and site-origin discovery) versus the **public contract** in this repo and what integrators read in docs.

**Expected outputs:**

| Output | Owner (typical) |
|--------|------------------|
| Backend fixes (no spurious 500s, structured errors) | API / platform team (deployed service) |
| OpenAPI + generated `public/openapi.json` accurate | This repo + release pipeline |
| `lib/api-reference-data.ts` parity with OpenAPI | This repo |
| Public docs: discovery URL clarity, batch semantics | This repo (`content/docs/*.mdx`) |
| Health / capability telemetry aligned with reality | Backend + observability |

**Evidence source:** External smoke suite `Modelling/riskmodels_api_smoke.py` and manual calls against production, plus inspection of [`OPENAPI_SPEC.yaml`](../OPENAPI_SPEC.yaml), [`lib/api-reference-data.ts`](../lib/api-reference-data.ts), and [`content/docs/`](../content/docs/).

---

## Priority queue (use for ticketing)

Order reflects **user impact** and **contract risk**. Do not treat all findings as equal urgency.

| Priority | Item | Rationale |
|----------|------|-----------|
| **P0** | `GET /ticker-returns` long-window **HTTP 500** | Documented `years` range promises success; 500s break clients and burn trust. Latest run: `years=10` failed. |
| **P1** | `/.well-known/*` vs API base URL (OpenAPI + docs) | Generated clients and integrators following spec hit **wrong URLs** (`/api/.well-known/...` → 404). |
| **P1** | `POST /batch/analyze` HTTP status vs per-ticker outcomes | **200** with all failures or `Unknown error` is ambiguous; clients cannot implement reliable retry logic. |
| **P2** | `GET /l3-decomposition` 500s and telemetry | **Not exercised** in the latest smoke run (default skip). Re-prioritize to P0/P1 once reproduced post-deploy or if telemetry shows active degradation. |

---

## Latest smoke snapshot (client updated; API fixes not yet deployed)

Captured from a full **`python riskmodels_api_smoke.py`** run against production on **2026-03-21** (Modelling repo; BWMACRO venv). This is **after** smoke-test client fixes (discovery root for `/.well-known`, default skip for `GET /l3-decomposition`, batch preview prefers best `summary`) and **before** any server-side fixes tracked here.

| Metric | Value |
|--------|--------|
| **Outcome** | **47 / 48** rows with `ok=True` (one HTTP failure) |
| **Failed request** | `GET /ticker-returns` case `tr_y10_json` — `years=10`, `format=json`, ticker `NVDA` → **HTTP 500** (~24s) |
| **`/.well-known/*`** | **200** when requested at site origin `https://riskmodels.net` (Finding 1 — **spec still misleading** for clients that only know `/api`) |
| **`GET /l3-decomposition`** | **Not exercised** in this run (`RISKMODELS_SKIP_L3_DECOMPOSITION` default **skip**); Finding 2 remains valid when the route is called |
| **`POST /batch/analyze`** | **200**; preview taken from batch with **3/3** per-ticker `success` (contrast with earlier runs where all tickers showed `Unknown error` — **intermittent backend or timing**) |
| **Telemetry (same session)** | `capabilities.ticker-returns` and `capabilities.l3-decomposition` still showed **unavailable** / **~0.47** success rate for ticker-returns in the snapshot row |

**Immediate action (P0):** fix **`/ticker-returns` long-window 500s** (not only `years=15`; **`years=10`** failed in this run).

---

## Objectives

1. Align **documented behavior** with **deployed routing** (especially discovery URLs).
2. Eliminate or clearly bound **HTTP 500** responses where the contract promises 2xx with valid inputs.
3. Make **batch** responses unambiguous when some or all tickers fail.
4. Keep **telemetry / health** truthful relative to endpoint behavior.

---

## Release sequence (contract vs deployment)

Use this to avoid shipping contradictory spec and behavior.

1. **Backend fix first (preferred when contract range is intended):** Keep OpenAPI/docs at current promises; deploy fix; re-run smoke; update snapshot dates in this brief.
2. **Cannot guarantee current contract:** Tighten **`maximum` for `years`** (and prose) in OpenAPI + [`lib/api-reference-data.ts`](../lib/api-reference-data.ts) + [`content/docs/api.mdx`](../content/docs/api.mdx); return **422/413** (or documented 503) with a clear message instead of **500** until the backend catches up.
3. **HTTP semantics change (e.g. batch):** Update [`OPENAPI_SPEC.yaml`](../OPENAPI_SPEC.yaml), interactive reference data, **and** client-facing docs in one release; note breaking change if any public client depends on “always 200.”

---

## Evidence bundle (attach to tickets / updates)

Standardize new findings so SRE and engineering can act without re-discovery.

- **Request:** Minimal repro (`curl` one-liner or smoke case id + params).
- **Environment:** `https://riskmodels.net/api` vs site origin; date/time (UTC).
- **Response:** HTTP status, latency, response body snippet (redact secrets).
- **Correlation:** `request_id` from JSON `_agent` / headers if present; trace id from internal tools.
- **Source:** smoke row, manual call, or telemetry-only (label which).

---

## Ownership and file targets (this repo)

| Artifact | Path | Role |
|----------|------|------|
| Canonical OpenAPI | [`OPENAPI_SPEC.yaml`](../OPENAPI_SPEC.yaml) | `servers`, paths, `maximum` for query params, response codes |
| Built spec (site) | `public/openapi.json` | Regenerated from YAML (e.g. `npm run build:openapi`) |
| Interactive API reference | [`lib/api-reference-data.ts`](../lib/api-reference-data.ts) | Must **reconcile** with OpenAPI (params, descriptions, status lines) |
| API overview / endpoints table | [`content/docs/api.mdx`](../content/docs/api.mdx) | Discovery URLs, endpoint summaries, pricing copy |
| Agent integration | [`content/docs/agent-integration.mdx`](../content/docs/agent-integration.mdx) | MCP setup; add **Discovery vs API** if agents fetch manifests |
| Error patterns (reference) | [`ERROR_SCHEMA.md`](../ERROR_SCHEMA.md) (repo root) | Align if new status codes or error shapes ship |

**Deployed API** behavior changes happen outside this repo; this repo tracks **contract and docs** that must match after deploy.

---

## Finding 1: `/.well-known/*` vs API base URL

**Observation:** OpenAPI lists paths such as `/.well-known/mcp.json` under `servers[0].url` = `https://riskmodels.net/api`, which implies `https://riskmodels.net/api/.well-known/...`. Those URLs return **404** (HTML). The live manifests are served at **`https://riskmodels.net/.well-known/...`** (site origin, no `/api` prefix).

**Ask:**

- In OpenAPI, either document **`servers`** for discovery as the site origin, **or** add explicit **full URLs** in the path descriptions for well-known resources.
- Add a short **“Discovery vs API”** subsection in public docs so integrators do not prefix `/.well-known` with `/api`.

**Owner:** Backend/routing only if you choose to **also** serve `/.well-known` under `/api` (optional); otherwise **spec + docs** in this repo.

**Primary files:** [`OPENAPI_SPEC.yaml`](../OPENAPI_SPEC.yaml) (`servers`, `/.well-known/*` path descriptions), [`content/docs/api.mdx`](../content/docs/api.mdx), [`content/docs/agent-integration.mdx`](../content/docs/agent-integration.mdx).

**Done when:**

- Generated clients using only the spec can resolve correct discovery URLs **without** guessing.
- Public docs state explicitly: **API base** vs **site origin** for `/.well-known/*`.
- Smoke or manual check: documented URLs match **200** responses.

---

## Finding 2: `GET /l3-decomposition` returns HTTP 500

**Observation:** Valid query parameters (`ticker`, `market_factor_etf`, and in some references `years`, `format`) produced **`500`** with a generic JSON body like `{"error":"Internal Error"}`. Telemetry showed **`l3-decomposition`** with **low success rate** (e.g. ~0.46) and sometimes **unavailable** / high latency.

**Note:** Latest smoke run **skipped** this route by default — do **not** assume green until re-run with skip disabled.

**Ask:**

- **Backend:** Trace 500s (timeouts, nulls, data gaps, regression). Return **structured errors** (correlation id, safe message) when possible.
- **Contract:** If degraded, **document** rate limits, fallback behavior, or **503** + `Retry-After` where appropriate.
- **Telemetry / health:** **Capability status** matches observed success rates and error budgets.

**Owner:** Primarily **deployed service**; contract/docs/telemetry copy in this repo.

**Primary files:** [`OPENAPI_SPEC.yaml`](../OPENAPI_SPEC.yaml), [`lib/api-reference-data.ts`](../lib/api-reference-data.ts), plus health/capability documentation if maintained in MDX.

**Done when:**

- Reproducible path: either **no 500** for documented valid inputs, or documented **non-5xx** degradation with client-actionable body.
- Telemetry for `l3-decomposition` does not contradict observed smoke/manual results.

---

## Finding 3: `GET /ticker-returns` — long history returns HTTP 500

**Observation:** Shorter windows succeed (e.g. **`years=1`**, **`years=5`**, CSV, `limit`, parquet). Longer windows are **not reliable**: **2026-03-21** snapshot — **`years=10`** → **HTTP 500** ~24s. Earlier runs: **`years=15`** / **`years=10`** intermittent **500**. OpenAPI allows **`years` up to 15**.

**Ask:**

- **Backend:** Fix root cause (payload size, timeout, query limits, cold path) or enforce a **lower max** in code so in-range parameters do not 500.
- **Contract:** Until stable, **lower `maximum` in OpenAPI** and docs to **match production**; return **413/422** with a clear message instead of **500** when too large or unsupported.

**Owner:** **P0** backend; this repo updates spec/docs to match **truth** or **intended** contract after decision.

**Primary files:** [`OPENAPI_SPEC.yaml`](../OPENAPI_SPEC.yaml) (`years` schema), [`lib/api-reference-data.ts`](../lib/api-reference-data.ts), [`content/docs/api.mdx`](../content/docs/api.mdx) (endpoints table says “up to 15y”).

**Done when:**

- For every `years` value **within documented range** (and representative tickers), smoke expects **no 500**; OR range is reduced everywhere with explicit client errors for out-of-range/over-size.
- **47/48 → 48/48** on full smoke for ticker-returns cases, or documented exclusions removed from default suite.

---

## Finding 4: `POST /batch/analyze` — HTTP 200 vs per-ticker outcomes

**Observation (intermittent):** Some runs: **200** while **every** ticker `status: error` with **`Unknown error`**. **2026-03-21:** **200** with **3/3 success** for preview batch. Failure mode **not deterministic** from the client.

**Ask:**

- **Backend:** Actionable per-ticker **codes/messages** (no opaque “Unknown error” when failure is known).
- **API design:** If **all** tickers fail, consider **207** / **422** or a **documented rule** tying HTTP status to **`summary.errors`** / **`summary.success`**.
- **Docs:** Describe **`summary.success` / `summary.errors`** vs HTTP status and **retry** guidance.

**Owner:** Backend for behavior; this repo for OpenAPI + reference + MDX.

**Primary files:** [`OPENAPI_SPEC.yaml`](../OPENAPI_SPEC.yaml), [`lib/api-reference-data.ts`](../lib/api-reference-data.ts), [`content/docs/api.mdx`](../content/docs/api.mdx), optionally [`ERROR_SCHEMA.md`](../ERROR_SCHEMA.md).

**Done when:**

- OpenAPI and docs specify the **rule** clients should implement (including “200 partial success” if kept).
- No unexplained **Unknown error** when server knows the cause (map to stable error codes/messages).

---

## Finding 5: Metrics and validation (reference pattern)

**Observation:** `GET /metrics/{invalid}` correctly returns **404** with JSON `{"error":"Symbol not found"}` — **no change required**.

**Use as:** Reference pattern for **client errors** (clear message, appropriate status, JSON body).

---

## Non-goals for this prompt

- Not a substitute for **runbooks** or **on-call** procedures; use internal logs and traces for incident response.
- Client-side smoke tests in other repos may change; **source of truth** for behavior remains the **deployed API** and the **published contract** in this repo.

---

## Reconciliation checklist (after any behavior or contract change)

Use before closing an epic or release:

- [ ] [`OPENAPI_SPEC.yaml`](../OPENAPI_SPEC.yaml) updated (`servers`, paths, params, responses).
- [ ] `public/openapi.json` regenerated if applicable.
- [ ] [`lib/api-reference-data.ts`](../lib/api-reference-data.ts) matches OpenAPI (no stale `years` range, status lists, or param descriptions).
- [ ] [`content/docs/api.mdx`](../content/docs/api.mdx) and agent docs updated for discovery and endpoint semantics.
- [ ] Smoke suite expectations updated if behavior **intentionally** changes (`Modelling/riskmodels_api_smoke.py` or documented skip flags).
- [ ] Snapshot date + outcome table at top of this brief refreshed after deploy verification.

---

## References (file map)

| Area | Location |
|------|----------|
| OpenAPI source | [`OPENAPI_SPEC.yaml`](../OPENAPI_SPEC.yaml) |
| Built OpenAPI JSON | `public/openapi.json` |
| Interactive reference sidebar | [`lib/api-reference-data.ts`](../lib/api-reference-data.ts) |
| Public API overview | [`content/docs/api.mdx`](../content/docs/api.mdx) |
| Agent / MCP setup | [`content/docs/agent-integration.mdx`](../content/docs/agent-integration.mdx) |
| Error vocabulary | [`ERROR_SCHEMA.md`](../ERROR_SCHEMA.md) |
| Smoke harness (external) | `Modelling/riskmodels_api_smoke.py` in the Modelling workspace |
