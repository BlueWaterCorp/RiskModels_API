# API audit suite

Run everything:

```bash
./api_audits.sh                 # static + live (needs an API key; bills a little)
AUDIT_SKIP_LIVE=1 ./api_audits.sh   # static only (CI / no key / no billing)
```

Reports are written to `audit-reports/<timestamp>/` (gitignored).

## What runs

| Step | Script | Network | Fails the gate? |
|------|--------|---------|-----------------|
| `openapi-yaml` | `OPENAPI_SPEC.yaml` parses | no | yes |
| `cli-openapi` | `scripts/cli-openapi-check.mjs` (CLI routes ⊆ spec) | no | yes |
| `route-drift` | `scripts/audit/openapi_route_drift.py --strict` | no | yes (untracked) |
| `docs-conformity` | `scripts/audit/docs_conformity.py --strict` | no | yes (untracked) |
| `migration-drift` | `scripts/audit/migration_drift.py` | prod schema read | no (reports; SKIPs without creds) |
| `schema-selftest` | `scripts/audit/live_schema_check.py --self-test` | no | yes |
| `smoke-endpoints` | `sdk/scripts/smoke_v3_all_endpoints.py` | **yes** | yes (critical only) |
| `schema-check` | `scripts/audit/live_schema_check.py` (consumes smoke report) | no | no (reports) |
| `store-freshness` | `scripts/audit/store_freshness.py` (metadata + newest date of every API zarr store vs the release session) | GCS read | yes |
| `golden-probe` | `scripts/audit/golden_ticker_probe.py` (values on NVDA, XOM, CAT: sector betas, ER sums, session, no silent zeros) | **yes** (12 calls) | yes |

The orchestrator writes `audit-reports/<ts>/summary.json` (per-check PASS/FAIL/SKIP)
for the email step.

## After every publish

Run these two right after an ERM3 publish finishes (`full_only_publish` / nightly release):

```bash
python scripts/audit/store_freshness.py          # exit 1 if a store is stale, unreadable or retired-but-published
python scripts/audit/golden_ticker_probe.py      # exit 1 if a live value is wrong; needs RISKMODELS_API_KEY
```

They exist because of RMAPI-30. For months the hedge-basket route returned `beta_to_spy = 0`
on every sector leg: it read a store the pipeline no longer published, and the cohort store
that replaced it was stuck at 2026-10-23 behind an ERM3 gate warning. Every response was a 200,
so the smoke tests that check status codes passed. These two checks look at data age and values.
Store cadences and the retired-store list live in the `STORES` and `RETIRED` tables at the top
of `store_freshness.py`. When ERM3 adds or retires a published store, update them there.

Call site for automation, not wired yet: the end of ERM3's publish, after
`sync_to_gcs_asset` (`erm3/shared/assets_data.py`) writes the release manifest under
`gs://rm_api_data/eodhd/_manifests/`. Wiring it there makes the ERM3 publish job depend on
this repo and needs a decision on what a failure does: the release is already live by then,
so a failure should page rather than roll back. Until that is decided, run both by hand or
from the weekly audit.

## Migration drift

**`migration_drift.py`** — parses `BWMACRO/supabase/migrations` (`CREATE TABLE` /
`ALTER … ADD COLUMN`) and diffs against the live prod schema (PostgREST OpenAPI).
Catches the recurring "column declared in a migration but never applied to prod"
failure (C.7 `tier`, C.9 `stripe_payment_method_id`). Reads `$AUDIT_MIGRATIONS_DIR`
(default `../BWMACRO/supabase/migrations`) + `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`;
SKIPs (exit 0, written to the report) if either is missing.

## Weekly deployment + email

`.github/workflows/weekly-audit.yml` runs the suite every **Saturday 13:00 UTC**
(+ `workflow_dispatch` for manual runs) and emails the digest to
**conrad@bwmacro.com** via Resend (`scripts/audit/send_audit_email.py`). The email
reports each check as PASS / FAIL / **SKIPPED** so a green digest can't hide a
check that didn't run. Email sends on failure too (`if: always()`); the run is
marked red afterward. Required secrets are documented at the top of the workflow.

## The two new audits

**`openapi_route_drift.py`** — static. Compares every OpenAPI path against the
Next.js `app/**/route.ts` handlers (params normalized to `{}`, leading `/api`
stripped, `next.config` rewrites/redirects honored). Reports:
- documented paths with **no** handler → fails `--strict`;
- handlers with **no** spec entry → informational;
- a cross-reference matrix (`route_drift.json`).

Known-but-tracked gaps live in `drift_allowlist.json` (`known_issues`): reported
every run, but they don't fail the gate, so the gate still catches *new* drift.

**`live_schema_check.py`** — validates the live JSON 2xx bodies captured by the
smoke run against their OpenAPI response schemas (`$ref`s inlined, OpenAPI-3.0
`nullable` honored, permissive on extra fields). Prints a coverage headline
(validated / skipped) so a green run can't hide "checked nothing". Reporting by
default; add `--strict` to enforce once spec and responses are reconciled.
`--self-test` proves the validator flags a broken body.

**`docs_conformity.py`** — static. Checks the hand-maintained MDX docs
(`content/docs/*.mdx`) against the spec: every `/api/...` path mentioned in the
docs must match an OpenAPI path template (concrete values like `/api/metrics/AAPL`
match `/metrics/{ticker}`), and every internal `/docs/<slug>` link must resolve
to an MDX file. Endpoint-table costs are compared to `x-pricing.cost_usd` and
reported. Acceptable prose mentions and tracked defects live in
`docs_conformity_allowlist.json` (`phantom_ok` / `known_issues`).

## Adding a new documented endpoint

Register it in `lib/docs-nav.ts` (for docs) and ship an `app/api/.../route.ts`;
`route-drift --strict` fails if a documented path has no handler.
