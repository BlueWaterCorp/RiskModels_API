# Jules.google — weekly audit of RiskModels API / SDK / CLI health

## Purpose and audience

This is a **self-contained audit brief** for a Jules.google session. The goal is to catch drift between the deployed API at `https://riskmodels.app/api`, the TypeScript API code in this repo, the Python SDK under `sdk/`, the TypeScript CLI under `cli/`, and the MCP / OpenAPI schemas — **before a customer reports an outage**.

- **Cadence**: weekly (configure in Jules as a scheduled session, e.g., Sunday 09:00 UTC).
- **Scope**: health checks only. **Jules must not open PRs**. If a check fails, Jules files an issue and stops; humans decide the fix.
- **Trust model**: Jules runs the audit against the deployed production API and reads the repo at `main`. It may require a read-only GCS credential for the zarr diagnostic; if unavailable, skip that step and note it in the report.

## Expected outputs

Jules should produce a single structured report with:

1. A one-line **overall verdict** (`PASS` / `PARTIAL` / `FAIL`).
2. A **per-check table** with status + evidence (command, exit code, key output lines).
3. A **findings list** for anything that needs human attention, ordered by severity.
4. An **issue draft** (title + body) if anything is `FAIL`. Jules opens the issue; does not open a PR.

Aim for < 800 words total in the report. Prefer terse, cite-the-evidence style.

## Preconditions

- Working clone of `BlueWaterCorp/RiskModels_API` at `main`.
- Node 20+, Python 3.12+, `pytest`, `httpx`, `pyarrow`, standard build tools.
- `TEST_API_KEY` env var — a live RiskModels API key with at least free-tier access. (Same one the GitHub `smoke-test.yml` workflow uses.)
- Optional: `GOOGLE_APPLICATION_CREDENTIALS` pointing at a read-only service account for `gs://rm_api_data/eodhd/`. If absent, skip step 8.
- The audit does **not** need Supabase, Redis, or any write credentials. It is strictly read-only.

## Audit checklist (run in order)

### 1. Repo sanity

```bash
git fetch origin
git status
git log --oneline origin/main -5
```

Jules asserts: working tree clean, HEAD at `origin/main`, no unexpected drift.

### 2. Typecheck the API + CLI

```bash
npm ci
npx tsc --noEmit -p tsconfig.json
cd cli && npm ci && npx tsc --noEmit -p tsconfig.json && cd ..
```

Exit code 0 required on both.

### 3. Unit tests (TypeScript)

```bash
npx vitest run tests/
```

All tests must pass. Jules records the total count; a significant drop since last week is a finding.

### 4. Python SDK tests

```bash
python3 -m venv .audit_venv
source .audit_venv/bin/activate
pip install -e 'sdk[dev]' 2>&1 | tail -5
python3 -m pytest sdk/tests/ -q
deactivate
```

All tests must pass. Note that the SDK pulls in `pyarrow`, `httpx`, `pandas`, etc. Installation is heavy — plan for ~60s the first time.

### 5. CLI build + health command

```bash
cd cli
npm run build
node dist/index.js health
cd ..
```

The CLI's `health` subcommand hits `https://riskmodels.app/api/health` and exits 0 if `status !== "down"`. This is the canonical liveness probe.

### 6. OpenAPI / discovery endpoints

```bash
curl -fsS https://riskmodels.app/openapi.json -o /tmp/prod-openapi.json
python3 -c "import json; spec=json.load(open('/tmp/prod-openapi.json')); print('paths=', len(spec.get('paths', {})))"
diff <(python3 -c "import json,sys; d=json.load(sys.stdin); print(sorted(d.get('paths',{}).keys()))" < OPENAPI_SPEC.yaml 2>/dev/null || python3 -c "import yaml,sys,json; print(sorted(yaml.safe_load(sys.stdin).get('paths',{}).keys()))" < OPENAPI_SPEC.yaml) <(python3 -c "import json,sys; d=json.load(sys.stdin); print(sorted(d.get('paths',{}).keys()))" < /tmp/prod-openapi.json)
```

Any diff in the endpoint path list between the repo's `OPENAPI_SPEC.yaml` and the deployed `/openapi.json` is a finding — the deployed contract and the committed spec must agree.

### 7. Authenticated endpoint smoke (prod data plane)

Run each of these with `Authorization: Bearer $TEST_API_KEY` against `https://riskmodels.app/api`:

| Endpoint | Assertion |
|---|---|
| `/health` | `status in {"healthy", "degraded"}` |
| `/balance` | `can_make_requests == true` |
| `/tickers?search=AAPL` | response contains `AAPL` |
| `/metrics/AAPL` | top-level `ticker`, nested `metrics` dict, one of `l3_mkt_hr` / `l3_mkt_er` / `l3_sec_hr` / `l3_sub_hr` / `l3_res_er` present |
| `/ticker-returns?ticker=NVDA&years=1&format=json` | `data.length > 0`; first row has `date` + one of `l3_mkt_hr`/`l3_cfr`; **retry up to 5x** because the zarr symbol-index path has historically flapped (see `docs/ZARR_SYMBOL_INDEX_FLAP.md`) |
| `/ticker-returns?ticker=SPY&years=1&format=json` | `data.length > 0`; confirms `ds_etf.zarr` routing is working (a FAIL here usually means the ETF store fell out of the reader) |
| `/l3-decomposition?ticker=NVDA&years=1` | `dates.length > 0`; `l3_market_hr.length == dates.length` |
| `/l3-decomposition?ticker=NVDA&years=5` | `dates.length > 500`; confirms `years` kwarg is wired through end to end |

For any FAIL, Jules captures the full request URL, response status, response body (first 500 bytes), and latency.

### 8. Zarr decode diagnostic (optional, requires GCS ADC)

```bash
node scripts/diagnose-zarr-decode.mjs
```

Must print `PASS — NVDA returns real data from all three stores` and `PASS — SPY returns real daily data from ds_etf.zarr`. Any `FAIL` is a P0 finding — check [`lib/dal/zarr-reader.ts`](../lib/dal/zarr-reader.ts) dtype dispatch first per [`MAINTENANCE_GUIDE.md`](../MAINTENANCE_GUIDE.md).

### 9. MCP / schema drift

```bash
ls mcp/data/schemas/ | wc -l
python3 -c "import json; print(len(json.load(open('mcp/data/openapi.json'))['paths']))"
```

Compare against the committed values in the last audit report. A drop in either count without a corresponding commit in the history is a finding. The full drift check lives in `.github/workflows/drift-detection.yml` — Jules should verify that workflow ran successfully on the most recent commit to `main` via `gh run list --workflow=drift-detection.yml --limit 1`.

### 10. CI smoke test workflow state

```bash
gh run list --workflow=smoke-test.yml --limit 5 --json conclusion,createdAt,headSha
```

All five of the most recent runs should be `success`. A single failure is a finding; repeated failures are a P0.

## Severity levels

| Level | Meaning | Examples |
|---|---|---|
| **P0** | Data plane broken; customers affected right now | `/ticker-returns` empty across retries; `/health` returns `status: "down"`; smoke test workflow has failed 3+ runs in a row |
| **P1** | Contract drift or degraded path | OpenAPI diff, typecheck or unit test failures, SDK install failures, CLI build failure |
| **P2** | Observability / documentation gap | Missing env var docs, stale capability in `sdk/riskmodels/capabilities.py`, drift-detection workflow failed |

## Report template

```markdown
# RiskModels weekly audit — {ISO date}

**Verdict**: {PASS | PARTIAL | FAIL}
**HEAD**: {short sha} — {commit subject}
**Audited from**: {Jules environment / runner identity}

## Check results

| # | Check | Status | Evidence |
|---|---|---|---|
| 1 | Repo sanity | ✅ | HEAD at origin/main |
| 2 | Typecheck (API+CLI) | ✅ | tsc --noEmit → 0 |
| 3 | Vitest (N tests) | ✅ | N / N pass |
| 4 | SDK pytest (M tests) | ✅ | M / M pass |
| 5 | CLI build + health | ✅ | status=healthy |
| 6 | OpenAPI diff | ✅ | 0 path diffs |
| 7 | Prod endpoint smoke | ✅ | all assertions met |
| 8 | Zarr diagnostic | ✅ / SKIPPED | {reason if skipped} |
| 9 | MCP schema counts | ✅ | drift-detection.yml green |
| 10 | smoke-test.yml recent runs | ✅ | 5/5 success |

## Findings

{ordered by severity, or "None this run"}

## Issue(s) filed

{link(s), or "None"}
```

## What NOT to do

- **Do not open PRs.** Health findings go into issues. A human decides the fix.
- **Do not modify env vars or secrets.** `TEST_API_KEY` is read-only.
- **Do not install the SDK into the user's home venv.** Use a disposable `.audit_venv/` under the repo clone and clean up after.
- **Do not run writes** — no `POST /batch/analyze` (except where explicitly listed — but the current brief lists none), no webhook registration, no Supabase writes.
- **Do not pivot mid-audit.** If a step fails, record the failure and move on to the remaining steps so the report is complete.

## Related references in this repo

- [`MAINTENANCE_GUIDE.md`](../MAINTENANCE_GUIDE.md) — operator guide, zarr gotchas, known pitfalls.
- [`docs/ZARR_SYMBOL_INDEX_FLAP.md`](./ZARR_SYMBOL_INDEX_FLAP.md) — post-mortem of the 2026-04-14 multi-bug incident.
- [`docs/CACHE_EMPTY_PAYLOAD_FIXES.md`](./CACHE_EMPTY_PAYLOAD_FIXES.md) — cache payload guards across layers.
- [`docs/API_HISTORY_SUPABASE_AND_ZARR.md`](./API_HISTORY_SUPABASE_AND_ZARR.md) — authoritative routing doc for history reads.
- [`docs/API_IMPROVEMENT_PROMPT.md`](./API_IMPROVEMENT_PROMPT.md) — companion execution brief for deeper API work (referenced for tone + structure; the two prompts are complementary, not overlapping).
- [`.github/workflows/smoke-test.yml`](../.github/workflows/smoke-test.yml) — the automated smoke test Jules mirrors.
