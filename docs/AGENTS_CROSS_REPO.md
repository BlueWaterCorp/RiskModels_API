# Cross-repo maintainer instructions

Canonical copy for **RiskModels_API**, **Risk_Models**, and **BWMACRO** workflows. This file is **synced from BWMACRO** into `docs/AGENTS_CROSS_REPO.md` in the API and portal repos (see below). Repo-specific agent briefs stay in each repo’s root **`AGENTS.md`**; **Claude Code** context stays in root **`CLAUDE.md`** (not synced).

When editing schemas, OpenAPI specs, MCP data, or tracking docs, follow the rules below.

---

## CRITICAL: Email template and SVG editing

**Lesson learned (April 3, 2026):** Repeated SVG edit mistakes in one session.

### Do not repeat

- Edit SVG and assume it is correct without visual check.
- Change email typography and move on without preview.

### Do repeat

- Edit conservatively, then build, preview, and verify logo + text render.
- Confirm logo has both icon and text; confirm closing tags are intact.

### Email template workflow

1. Read the full file first.
2. Build to catch syntax errors.
3. Preview in the admin panel (visual verification required).
4. Confirm logo, typography, spacing.
5. Only then mark complete.

**If an SVG edit goes wrong:** restore the entire file from source (e.g. Risk_Models repo) instead of incremental fixes.

In **RiskModels_API**, see `.cursorrules` for “Email Templates & SVG Editing” details.

---

## Cross-repo sync rules (always enforce)

Plan cross-repo impact first and **list manual sync steps** when changing contracts.

### 0. House PIT convention for point-in-time reads (`?as_of=`)

Any endpoint offering knowledge-time reads uses the D.8.39 shape (first shipped on
`/13f/filers/{id}/holdings` + `/portfolio`, 2026-07-06):

- Query param `as_of=YYYY-MM-DD` — "serve only what was public on or before this date".
- Selection runs on the knowledge axis (`filing_date`/`availability_date`), **never** on
  `report_date` silently. If the panel lacks knowledge stamps, fall back to report_date
  **and say so** via an `as_of_basis: "filing_date" | "report_date"` echo in the body.
- Nothing known by `as_of` → **404 with an as_of-specific message**, never an empty-but-200
  or the latest row.
- Bi-temporal stamps (`report_date`, `filing_date`) are **body fields** (headers optional
  mirrors) — SDK/MCP consumers never see headers.
- Never collapse `report_date` (economic truth) and availability (knowledge truth) — L-arc
  invariant, `docs/architecture/CANONICAL_INTELLIGENCE_OBJECTS.md`.

Applies to upcoming PIT surfaces: R.8 universe members, H.89.5 fundamentals, E.7 judgment.

### 1. Canonical schemas in RiskModels_API

JSON schemas (e.g. `estimate-v1.json`) are canonical **only** in `RiskModels_API/mcp/data/schemas/`. Create and edit them there.

### 2. Copy new schemas to Risk_Models

After adding a schema in RiskModels_API, copy to Risk_Models (or merge to **`main`** and let **Sync MCP data to Risk_Models** push the mirror):

```bash
cp RiskModels_API/mcp/data/schemas/NEW_SCHEMA.json \
   Risk_Models/riskmodels_com/mcp-server/data/schemas/
```

### 3. Update schema-paths.json in both repos

Add the new schema path to `schema-paths.json` in:

- `RiskModels_API/mcp/data/schema-paths.json`
- `Risk_Models/riskmodels_com/mcp-server/data/schema-paths.json`

### 4. Changelog in RiskModels_API

Add an entry to `RiskModels_API/CHANGELOG.md` for new endpoints, schemas, or format params.

### 5. Update backlog + current_state.md in BWMACRO

When adding formats (e.g. Parquet/CSV), new endpoints, or closing gaps:

1. Add or update a row in `BWMACRO/docs/ceo/MASTER_BACKLOG.md` (engineering burn-down SSOT).
2. Update `BWMACRO/docs/api_roadmap/current_state.md` for narrative consumers:
   - Response Format section
   - Data Endpoints table (Format column)
   - Known Gaps (strikethrough completed items)

### 6. Broadcast to user-visible sources

When API changes ship, run the **API Broadcast Checklist** in `BWMACRO/docs/api_roadmap/API_BROADCAST_PROCESS.md`:

- Colab notebook (Risk_Models canonical)
- erm3.md and web docs
- CHANGELOG, current_state, **MASTER_BACKLOG** (if scope changed)

### 7. Re-validate the `riskmodels-plugin` (public Claude Code plugin) — new API-contract consumer

`BlueWaterCorp/riskmodels-plugin` (public) is a downstream consumer of the hosted MCP
contract: its skills and cookbook name specific MCP tool ids (e.g. `riskmodels_get_fundamentals`)
and describe response shapes (e.g. fundamentals `sec_facts` per-cell provenance). It has **no
build-time link** to the API, so it rots silently when tools are renamed or response shapes change.

When MCP tool names, capability ids, or a documented response shape change (fundamentals,
decompose, hedge, rankings, lstar, residual-signal), **before each plugin release**:

1. Diff the referenced tool ids against **live** `riskmodels_list_endpoints` and the MCP tool
   surface (not repo source — E.29's lesson: served ≠ source).
2. Update `plugins/riskmodels/skills/*/SKILL.md`, `agents/riskmodels-analyst.md`, `cookbook.md`,
   and `README.md` for any renamed tool / changed shape. Keep skills thin (wrappers + prompts;
   no logic that can drift).
3. Copy gates apply to **all content** (README, SKILL.md, cookbook): approved sourcing phrase
   *"PIT-normalized fundamentals derived from SEC filings and licensed sources"*; never "IP-free";
   no layered/decomposed cost-of-capital methodology (CAPM-mode only); no investment advice.

Plan SSOT: `BWMACRO/docs/gtm/anthropic-agents-fundamentals-gtm.md` (E.30).
---

## Cursor / sync automation (BWMACRO to API and portal)

The following are **pushed from BWMACRO** on push to `main` (when watched paths change):

- `.cursor/rules/repo-sync-enforcer.mdc`
- `.agents/skills/repo-sync/SKILL.md`
- **`docs/AGENTS_CROSS_REPO.md`** (this document)

**Not overwritten by sync:** each repo’s root **`AGENTS.md`** (product or portal brief) and **`CLAUDE.md`**.

- **GitHub Actions:** `.github/workflows/sync-cursor-config.yml` in BWMACRO. Requires `REPO_ACCESS_TOKEN` secret in BWMACRO.
- **Fallback script:** `BWMACRO/scripts/sync-cursor-config.sh` — run locally; expects RiskModels_API and Risk_Models as sibling directories of BWMACRO.

---

## Automated sync: RiskModels_API → Risk_Models (MCP + OpenAPI)

When **OpenAPI** or **`mcp/data/*`** change on **`RiskModels_API` `main`**, GitHub Actions runs **`.github/workflows/sync-mcp-to-risk-models.yml`**:

1. Checks out the API repo, runs **`npm ci`** and **`npm run build:openapi`** (so `mcp/data/openapi.json` matches `OPENAPI_SPEC.yaml`).
2. Clones **`Risk_Models`** using **`REPO_ACCESS_TOKEN`** (same secret as drift detection; needs **write** on that repo).
3. Copies **`schema-paths.json`**, **`openapi.json`**, **`schemas/*.json`**, and **`capabilities.json`** (if present) into **`riskmodels_com/mcp-server/data/`**, then commits and pushes if there is a diff.

Also runs **weekly (Monday 06:00 UTC)** and via **`workflow_dispatch`** for a manual reconcile.

**BWMACRO → API** cursor-config sync (rules, `AGENTS_CROSS_REPO.md`) remains the separate workflow **`sync-cursor-config.yml`** on **this** repo.

---

## Related config

- **Cursor rule:** `.cursor/rules/repo-sync-enforcer.mdc` — applies when editing `*.json`, `OPENAPI_SPEC.yaml`, `schema-paths.json`, `CHANGELOG.md`, `MASTER_BACKLOG.md`, `current_state.md`
- **Skill:** `.agents/skills/repo-sync/SKILL.md` — invoke with `@repo-sync-enforcer` for step-by-step sync workflow

---

## Repo roles

| Repo | Role |
|------|------|
| **BWMACRO** | Dagster deployment hub; `docs/ceo/MASTER_BACKLOG.md` + `docs/api_roadmap/current_state.md`; **hosted `.net` + Client Memory Layer strategy** — [`docs/architecture/intelligence_runtime/MANAGED_COGNITIVE_RUNTIME_STRATEGY.md`](./architecture/intelligence_runtime/MANAGED_COGNITIVE_RUNTIME_STRATEGY.md) |
| **RiskModels_API** | Canonical public API at `riskmodels.app`. Owns: `OPENAPI_SPEC.yaml`, data routes, `lib/agent/*`, `lib/dal/*`, MCP schemas, `schema-paths.json`, `CHANGELOG.md` |
| **Risk_Models** | User portal at `riskmodels.net`. Web UI, auth, MCP schema **copies** under `riskmodels_com/mcp-server/` |
| **riskmodels-plugin** | Public Claude Code plugin (marketplace-installable): hosted-MCP config + thin skills + analyst agent + cookbook. **Downstream consumer** of the MCP contract — re-validate per rule 7 on tool/shape changes. Copy gates apply to all content. |
