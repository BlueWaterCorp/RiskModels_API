# Canonical LSTAR dispatch update — 2026-09-09

## Behavior

GET `/api/lstar` and POST `/api/batch/lstar` preserve an omitted threshold and use
materialized `lstar_level`. An explicit threshold retains the legacy ER rule.
Every selected level dispatches its own complete HR vector and residual return.
Snapshot recommendations receive the materialized level. The existing economic
policy remains separate and may downgrade `recommended_hedge_level`; hedge-basket
legs now implement that final recommendation, including its level-specific SPY HR.

No ERM3 model, parameter, store, or production selector changes are required.
The API repo's accidentally tracked self-referential `node_modules` symlink is
removed; dependencies are installed normally using the existing lockfile.

## Mac Mini rollout

1. Locate the production API checkout and inspect its branch/status. Preserve any
   existing edits; do not reset or overwrite them. Fetch origin and fast-forward
   the deployment branch to the reviewed API commit using the normal workflow.
2. Use the production-supported Node version and `npm ci`. Run `npm run typecheck`
   and `npm test`; use the usual build and deployment/restart procedure for the
   service actually serving riskmodels.app. Do not assume the Mini itself hosts
   the public Next.js process: verify deployment ownership first.
3. Use an existing API key without printing it. Fetch `/api/metrics/NVDA`,
   `/api/lstar?ticker=NVDA&years=1`, and POST `/api/batch/lstar` with NVDA and no
   threshold. Align dates. Their canonical picks must match `metrics.lstar_level`.
   Compare every dispatched HR against `hedge_levels.L{selected}`. Market/SPY HR
   must change with level; lower-depth results must not retain L3 adjustments.
4. Explicit `threshold=0.01` must still apply the legacy rule and return its own
   level's complete vector. Inspect `/api/hedge-basket/NVDA`: `legs` must match
   `recommended_hedge_level`, which may differ from canonical LSTAR due to the
   documented economic gates. Do not treat that intentional difference as failure.
5. Confirm deployed revision and clean checkout; report actual checks and results.
   If stale responses remain, inspect deployment revision and relevant cache keys
   before any narrowly scoped cache refresh. Do not flush all production caches.

## Website and documentation propagation

- API `content/docs/methodology.mdx`, `content/docs/batch-lstar.mdx`, and CHANGELOG
  are updated in this change. Response keys, route names, and tool IDs are unchanged.
- Manual follow-up on riskmodels.org: replace the claim that canonical LSTAR is a
  fixed 1% rule with the engine's cost-aware walk-forward GBM selection; retain the
  threshold rule as a legacy/custom override. Explain depth-specific SPY hedges.
- Audit riskmodels.app API-reference text, SDK docstrings, and connector/tool
  descriptions that still summarize LSTAR as a 1% rule. Canonical clients should
  omit threshold, and UI consumers must use the full selected `hedge_levels` entry.
- Per cross-repo tracking rules, record the deployed commit and verification in
  BWMACRO `docs/ceo/MASTER_BACKLOG.md` and `docs/api_roadmap/current_state.md` on
  the appropriate branch. The Mac Air's BWMACRO checkout is on a separate feature
  branch and was intentionally not changed for this API rollout.
- No new MCP schema files or OpenAPI response shapes were introduced. No schema
  copying, schema-path additions, notebook API-shape migration, or plugin release
  is required for this fix. Public copy updates remain a separate propagation step.
