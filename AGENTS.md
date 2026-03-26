# RiskModels Agent Instructions

> **ROLE:** Financial Data Analyst & Risk Management Agent
> **SCOPE:** Quantitative analysis of US equity factors and hedge ratios.

The RiskModels API returns factor decompositions and hedge ratios for ~3,000 US equities, with history dating back to 2006.

## Technical Details

- **API Base URL:** `https://riskmodels.app`
- **OpenAPI Spec:** [OPENAPI_SPEC.yaml](./OPENAPI_SPEC.yaml)
- **MCP Server:** [mcp/](./mcp/)
- **Python SDK (source):** [sdk/](./sdk/) — [`riskmodels-py` on PyPI](https://pypi.org/project/riskmodels-py/)
- **Skill Guide:** [SKILL.md](./SKILL.md)
- **Authentication:** OAuth2 client credentials flow
- **Get API Key:** [riskmodels.app/get-key](https://riskmodels.app/get-key) — OAuth/magic-link; key copy UX is post-login under Account → Usage.

## Next.js portal + `cli/` (Vercel builds)

The developer portal is the **repo root** Next app. The **CLI** lives in [`cli/`](./cli/) with its **own** [`cli/package.json`](./cli/package.json).

- Root [`tsconfig.json`](./tsconfig.json) includes `**/*.ts`, so `next build` **typechecks** `cli/src/**/*.ts` using dependencies from the **root** [`package.json`](./package.json) only.
- **Vercel** runs `npm ci` at the **root**. It does **not** install `cli/package.json` unless you add a custom install step. If the CLI imports a package that exists only under `cli/`, the local CLI folder may work while **Vercel fails** with “Cannot find module …”.

**Do one of the following when adding or changing CLI-only imports:**

1. **Recommended for current layout:** Add the same **runtime** packages to the **root** `dependencies` (and any needed `@types/*` to root `devDependencies`), run `npm install`, and commit **`package-lock.json`**. Keep versions aligned with `cli/package.json` when practical.
2. **Alternative:** Narrow root `tsconfig.json` `include` / add `"exclude": ["cli"]` so the portal build does not typecheck the CLI, and rely on `cd cli && npm ci && npm run build` (e.g. in CI) for CLI correctness.

**Related gotcha:** Commander’s `optsWithGlobals` is not typed as generic; use `(cmd.optsWithGlobals() as { json?: boolean })` (or similar) instead of `optsWithGlobals<{…}>()` so `next build` passes under `strict`.

## Agentic Workflows

When a user requests risk analysis, you should:
1. Identify the ticker(s) and time frame.
2. Use the MCP server tools to fetch factor data.
3. Interpret the results (e.g., high residual risk, sector exposures).
4. Provide actionable hedge ratios if requested.
