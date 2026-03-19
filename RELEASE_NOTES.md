# RiskModels API v3 — ERM3 Hierarchical Factor Model

The RiskModels API provides institutional-grade equity risk analysis, including factor decompositions and ETF-executable hedge ratios for ~3,000 US equities with history back to 2006. The API is AI-agent ready with a built-in MCP server.

Visit the Developer Portal at [riskmodels.app](https://riskmodels.app).

---

## Release Summary

Successfully synchronized the RiskModels_API repository with the Private Engine & Agent Bridge implementation from the Risk_Models repository. All documentation and OpenAPI specifications have been updated to reflect v3.0.0-agent capabilities.

### Key Features
- **ERM3 Hierarchical Factor Model** — Enhanced risk decomposition with better sector/subsector precision.
- **MCP Server** — First-class Model Context Protocol support for AI agents.
- **OAuth2 Authentication** — Secure client credentials flow for production applications.
- **Parquet/CSV Format Support** — High-performance bulk data export for backtesting.
- **Developer Portal** — Comprehensive documentation, interactive API reference, and quickstart guides at riskmodels.app.

### New Endpoints
- `POST /api/auth/token` - Generate OAuth2 access token
- `GET /api/mcp/sse` - MCP SSE connection
- `POST /api/mcp/sse` - MCP JSON-RPC requests
- `GET /api/plaid/holdings` - Fetch enriched holdings with risk metrics
- `GET /.well-known/ai-plugin.json` - OpenAI GPT Store manifest
- `GET /.well-known/agentic-disclosure.json` - Privacy disclosure
- `GET /.well-known/mcp.json` - MCP server manifest

### Breaking Changes
- **Authentication Required** - All protected endpoints now require Bearer token or OAuth2.
- **Rate Limits Enforced** - 60 req/min default, 429 responses on exceeded.
- **New Error Codes** - Added handling for 402 (payment required) and 429 (rate limit).

For detailed migration instructions, see [MIGRATION_V3.md](./MIGRATION_V3.md).
