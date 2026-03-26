---
name: repo-sync-enforcer
description: Prevents drift in schemas, schema-paths.json, OpenAPI, and docs across BWMACRO, RiskModels_API, and Risk_Models. Activates on schema/JSON/OpenAPI/doc changes.
---

# Repo Sync Enforcer

When editing schemas, OpenAPI specs, MCP data, or tracking docs across the RiskModels repos, follow this workflow to prevent drift.

## Step 1: Identify Canonical Repo

| Asset | Canonical Repo | Path |
|-------|----------------|------|
| JSON schemas | RiskModels_API | `mcp/data/schemas/*.json` |
| schema-paths.json | RiskModels_API (edit first) | `mcp/data/schema-paths.json` |
| OPENAPI_SPEC.yaml | RiskModels_API | `OPENAPI_SPEC.yaml` |
| CHANGELOG | RiskModels_API | `CHANGELOG.md` |
| current_state.md, Known Gaps | BWMACRO | `docs/api_roadmap/current_state.md` |

## Step 2: New Schema Workflow

1. **Create/edit schema** in `RiskModels_API/mcp/data/schemas/`
2. **Add to schema-paths.json** in RiskModels_API:
   ```json
   "/schemas/NEW_SCHEMA-v1.json"
   ```
3. **Copy schema to Risk_Models**:
   ```bash
   cp RiskModels_API/mcp/data/schemas/NEW_SCHEMA-v1.json \
      Risk_Models/riskmodels_com/mcp-server/data/schemas/
   ```
4. **Update schema-paths.json** in Risk_Models (same entry)
5. **Add CHANGELOG entry** in RiskModels_API
6. **Update current_state.md** in BWMACRO if format/gap changed

## Step 3: OpenAPI Additions (e.g. format=parquet)

1. Edit `RiskModels_API/OPENAPI_SPEC.yaml`
2. Add parameter, response content types, schemas as needed
3. GitHub Actions will build `openapi.json` and push to Risk_Models on push to main
4. Update `current_state.md` Response Format / Data Endpoints table in BWMACRO

## Step 4: Sync Checklist (Always Output)

When making cross-repo changes, output this checklist and mark items as you complete them:

```
Sync checklist:
- [ ] RiskModels_API: schema/spec/changelog updated
- [ ] Risk_Models: schema copied, schema-paths.json updated (if schema added)
- [ ] BWMACRO: current_state.md updated (if format/gap changed)
- [ ] Manual copy steps executed (schemas, schema-paths.json)
```

## Step 5: Offer Sync Checklist Draft

At the end of your response, offer: "I can draft a sync checklist for the other repos, or a small bash script to automate the copies."

## Invocation

Prefix prompts with `@repo-sync-enforcer` when working on schemas, OpenAPI, or docs to invoke this skill. The Cursor rule `.cursor/rules/repo-sync-enforcer.mdc` also applies when editing matching files.
