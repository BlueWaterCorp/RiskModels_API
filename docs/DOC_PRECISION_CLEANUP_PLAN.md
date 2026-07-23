# Documentation precision cleanup plan

**Scope:** Hedge ratios vs classical betas, Supabase V3 naming, endpoint facts, and (optionally) marketing copy.  
**Canonical field semantics:** [SEMANTIC_ALIASES.md](../SEMANTIC_ALIASES.md), [ENGINE_METHOD_NOTES.md](../ENGINE_METHOD_NOTES.md) §3.

---

## Goals

1. **Stop equating `*_hr` with “betas”** in reference docs unless the text explicitly scopes meaning (e.g. informal “market beta” for the **L3 market leg only**, with a pointer to units and hierarchy).
2. **Align backend description with V3 reality:** replace stale references to legacy Supabase tables in the OpenAPI narrative.
3. **Correct user-facing endpoint summaries** where they disagree with implemented routes.

---

## Canonical definitions (single source of truth)

Keep **[SEMANTIC_ALIASES.md](../SEMANTIC_ALIASES.md)** as the normative field reference. Include a short subsection **“Hedge ratios vs classical regression betas”** that states:

- `*_hr` are **`dollar_ratio`** (ETF notional per $1 stock).
- At **L2/L3**, legs are **hierarchical, ETF-executable hedge weights**, not guaranteed to equal univariate OLS slopes of the stock on each ETF alone.
- **Explained risk (`*_er`)** is the right language for variance explained / hierarchical decomposition; cite **[ENGINE_METHOD_NOTES.md](../ENGINE_METHOD_NOTES.md)** §3.

Avoid duplicating long engine prose—link out.

---

## File-by-file changes (RiskModels_API)

### 1. [OPENAPI_SPEC.yaml](../OPENAPI_SPEC.yaml) — `info.description`

- **Problem:** Legacy mention of `erm3_betas` / `erm3_rankings` as the live Supabase contract.
- **Change:** Describe **V3** tables: `security_history`, `security_history_latest`, `symbols`, `trading_calendar`, `erm3_landing_chart_cache`, `macro_factors`. State that **rankings** come from rank metric keys in `security_history` (see `fetchTopRankingsSnapshot` in `lib/dal/risk-engine-v3.ts`), not a separate `erm3_rankings` table.
- **MCP tool copy:** `analyze_portfolio` description must **not** claim **Sharpe** unless the batch/metrics routes actually return it.

**Regenerate:** `npm run build:openapi` → updates `public/openapi.json` and `mcp/data/openapi.json`.

### 2. [SUPABASE_TABLES.md](../SUPABASE_TABLES.md)

- Replace the metric_key row that merged “Hedge ratios / betas” with precise **dollar_ratio** + hierarchical wording and a link to `SEMANTIC_ALIASES.md`.

### 3. [README_API.md](../README_API.md)

- **`/api/ticker-returns`:** Document **L3** HR/ER in the series; point to `/api/l3-decomposition`, `/api/data/security-history/...`, or OpenAPI for L1/L2 **history** as appropriate.
- **`/api/metrics/{ticker}`:** Do **not** claim Sharpe unless implemented; list actual snapshot fields (`metrics` nesting, wire keys).
- **Quickstart:** Use `m.metrics` and abbreviated wire keys (`l3_mkt_hr`, `l3_res_er`, `vol_23d`) consistent with the route.
- **Optional:** Short **Data plane** note for `/api/data/*` (not fully in OpenAPI; gateway soft-auth in `lib/gateway-auth.ts`).

### 4. [docs/SNAPSHOT_CONTENT_MAP.md](SNAPSHOT_CONTENT_MAP.md)

- Prefer **HR** / **hedge ratio** in wireframe copy; use “informal market beta” only where the narrative means L3 market HR or portfolio `portfolio_mkt_hr`-style aggregates.

### 5. [CHANGELOG.md](../CHANGELOG.md)

- Record doc + OpenAPI + optional portal/email changes under **[Unreleased]** (or the release that ships them).

### 6. Optional consistency pass

- Grep markdown for **`erm3_betas` / `erm3_rankings`** outside historical migrations/archives.
- **Sibling repos:** `Risk_Models/riskmodels_net` (email, glossary, `erm3_wisdom`, ticker tape mocks, MCP `openapi.json` sync), `RM_ORG` (README “copy precision” note; leave narrative Medium articles unless intentionally rewriting positioning).

---

## Verification

- `npm run build:openapi` succeeds; `mcp/data/openapi.json` has no stale **Data** paragraph and no false **Sharpe** in `analyze_portfolio` if removed from YAML.
- README_API endpoint table and quickstarts match `app/api/metrics/[ticker]/route.ts` and `app/api/ticker-returns/route.ts`.

---

## Out of scope (unless explicitly expanded)

- **Rewriting all marketing copy site-wide** (every landing sentence, blog, ad). The plan targets **reference accuracy** and **high-trust surfaces** (OpenAPI, SUPABASE, README_API, key components/emails), not a full brand rewrite.
- **API behavior changes** (e.g. adding Sharpe or L1/L2 columns to `ticker-returns`)—this plan is **docs-first** unless product requests it.

---

## Implementation status (as of 2026-04)

Executed in **RiskModels_API**: `SEMANTIC_ALIASES.md`, `OPENAPI_SPEC.yaml`, `SUPABASE_TABLES.md`, `README_API.md`, `docs/SNAPSHOT_CONTENT_MAP.md`, `sync-mcp-from-risk-models.sh` note, portal components (`UseCases`, `AgenticSection`, `TerminalShowcase`, pricing page), `emails/low-balance.tsx`, `lib/chat/system-prompt.ts`, `CHANGELOG.md`, OpenAPI JSON regen.

Executed in **Risk_Models** (`riskmodels_net`): mirrored `openapi.json`, same low-balance email pattern, `erm3_wisdom.md`, `glossary-data.ts` (`l1_mkt_hr`), `useTickerTapeData.ts` mocks, `about-panel.tsx`, `layout.tsx` keywords.

Executed in **RM_ORG**: `README.md` subsection on copy precision; Medium/dist narrative left unchanged by design.
