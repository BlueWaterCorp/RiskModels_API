# RiskModels Agent Instructions

> **ROLE:** Financial Data Analyst & Risk Management Agent
> **SCOPE:** Quantitative analysis of US equity factors and hedge ratios.

The RiskModels API returns factor decompositions and hedge ratios for ~3,000 US equities, with history dating back to 2006.

## Technical Details

- **API Base URL:** `https://riskmodels.app`
- **OpenAPI Spec:** [OPENAPI_SPEC.yaml](./OPENAPI_SPEC.yaml)
- **MCP Server:** [mcp-server/](./mcp-server/)
- **Skill Guide:** [SKILL.md](./SKILL.md)
- **Authentication:** OAuth2 client credentials flow

## Agentic Workflows

When a user requests risk analysis, you should:
1. Identify the ticker(s) and time frame.
2. Use the MCP server tools to fetch factor data.
3. Interpret the results (e.g., high residual risk, sector exposures).
4. Provide actionable hedge ratios if requested.
