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
| `schema-selftest` | `scripts/audit/live_schema_check.py --self-test` | no | yes |
| `smoke-endpoints` | `sdk/scripts/smoke_v3_all_endpoints.py` | **yes** | yes (critical only) |
| `schema-check` | `scripts/audit/live_schema_check.py` (consumes smoke report) | no | no (reports) |

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
