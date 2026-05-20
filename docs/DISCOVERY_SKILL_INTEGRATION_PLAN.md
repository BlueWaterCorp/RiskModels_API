# Discovery Skill Integration Plan

**Date:** 2026-04-05
**Skill:** `riskmodels-api-discovery` (`.cursor/skills/riskmodels-api-discovery/SKILL.md`)
**Trigger:** Skill upgraded in `fa06bc0`; need to align API routes, CLI endpoint, and MCP discovery data.

---

## Status snapshot

| Source | Entry count | Notes |
|--------|-------------|-------|
| `lib/agent/capabilities.ts` | ~15 capabilities | Canonical billing/pricing registry |
| `mcp/data/capabilities.json` | 12 entries | Stale — missing portfolio-risk-snapshot, plaid, cli-query, sdk-python |
| `mcp/data/schema-paths.json` | 9 indexed | 2 orphan schemas (`estimate-v1`, `risk-metadata-v1`) not indexed |
| `OPENAPI_SPEC.yaml` | Covers most routes | Missing `format=pdf\|png` on risk-snapshot, missing Plaid routes |
| SDK `capabilities.py` | Full method registry | Authoritative for Python client; includes `discover()` |

---

## 1. API — Align discovery sources with live routes

### 1a. Create `docs/portfolio-risk-snapshot-runbook.md`

The discovery skill references this file as the worked "discovery → minimal PDF client" example. It does not exist.

**Contents:** Step-by-step showing (1) call `riskmodels_list_endpoints`, (2) call `riskmodels_get_capability("portfolio-risk-snapshot")`, (3) minimal Python/curl to POST and receive PDF. Reference the SDK's `get_portfolio_risk_snapshot_pdf()` and the `examples/python/portfolio_risk_snapshot_pdf.py` script.

### 1b. Update `OPENAPI_SPEC.yaml`

- Add `format` enum (`pdf`, `json`, `png`) to `/portfolio/risk-snapshot` POST parameters.
- Add `application/pdf` and `image/png` response content types.
- Add Plaid routes (`/plaid/link-token`, `/plaid/exchange-public-token`, `/plaid/holdings`) — currently undocumented.

### 1c. Verify Zod ↔ capabilities ↔ OpenAPI alignment

Audit `lib/api/schemas.ts` against `capabilities.ts` parameter specs. Known risk: the risk-snapshot route accepts `title` (Zod) but some docs may reference `name`. The discovery skill explicitly warns about this.

---

## 2. CLI (`/api/cli/query`) — Surface through discovery

### 2a. Add `cli-query` to `mcp/data/capabilities.json`

The capability exists in `capabilities.ts` (id: `cli-query`, cost: $0.003/request) but is absent from the MCP data file. Agents using MCP discovery currently cannot find it.

### 2b. Update discovery skill fallback docs

Add a note in the discovery skill's "Repo sources" section that `cli-query` can be used for ad-hoc data exploration when the user wants raw SQL access (SELECT-only, rate-limited).

---

## 3. MCP — Sync discovery data with `capabilities.ts`

### 3a. Sync `capabilities.json` ← `capabilities.ts`

Add missing entries:

| Capability ID | Why missing |
|---------------|-------------|
| `portfolio-risk-snapshot` | New premium endpoint ($0.25) |
| `portfolio-risk-index` | Existed in code, never added to MCP |
| `plaid-link-token` | Integration endpoint |
| `plaid-holdings` | Integration endpoint |
| `plaid-exchange-token` | Integration endpoint |
| `batch-analysis` | Per-position billing |
| `sdk-python` | Version hint endpoint |
| `cli-query` | SQL access endpoint |

### 3b. Update `schema-paths.json`

Index all schema files in `mcp/data/schemas/`:
- Add `estimate-v1.json` (exists on disk, not indexed)
- Add `risk-metadata-v1.json` (exists on disk, not indexed)
- Create and add `portfolio-risk-snapshot-v1.json`
- Create and add `portfolio-risk-index-v1.json`

### 3c. Consider new MCP resource: `riskmodels:///semantic-aliases`

The discovery skill references `SEMANTIC_ALIASES.md` as a key repo source, but the MCP server doesn't expose it. Adding it as a resource lets agents using MCP-only discovery (no repo checkout) access field name mappings.

---

## 4. Cross-cutting alignment

### 4a. Root `SKILL.md` ↔ discovery skill consistency

Both files now reference MCP tools. Verify tool names match (`riskmodels_list_endpoints`, `riskmodels_get_capability`, `riskmodels_get_schema`) and fallback order is identical.

### 4b. BWMACRO portfolio-hedge-analyst pricing

The BWMACRO skill references $0.002/position for batch analysis. Current `capabilities.ts` has $0.005/position. Update the BWMACRO skill's Step 2 cost estimate section.

### 4c. Repo-sync-enforcer checklist

After all changes, run the BWMACRO repo-sync-enforcer:
```
- [ ] RiskModels_API: capabilities.json, schema-paths.json, OpenAPI updated
- [ ] Risk_Models: schemas copied, schema-paths.json updated
- [ ] BWMACRO: current_state.md updated, hedge-analyst pricing corrected
```

---

## Execution order

1. **MCP data sync** (3a, 3b) — unblocks everything else
2. **OpenAPI update** (1b) — schema source of truth
3. **New schemas** (3b) — depend on OpenAPI being correct
4. **Runbook** (1a) — references correct schemas
5. **CLI discovery** (2a, 2b) — independent, can parallel with 3-4
6. **Cross-cutting** (4a-4c) — final pass
7. **Repo-sync-enforcer** (4c) — verify no drift
