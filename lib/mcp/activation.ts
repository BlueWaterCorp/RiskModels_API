/**
 * Post-connect activation copy — SSOT for MCP server instructions and the
 * first prompt. One text for every surface (npm stdio, /api/mcp/sse,
 * /api/mcp/openai): all three register the same tool set (tool set 2.0).
 *
 * OAuth/Smithery connect stamps last_used_at without a billed REST call.
 * The first prompt names two live data tools so the first turn returns data.
 */

/** Paste into Claude/Cursor/ChatGPT after the MCP connector is connected. */
export const FIRST_LIVE_PROMPT_MCP =
  'Call riskmodels_compare with tickers ["AAPL","NVDA"]. Then call riskmodels_decompose on AAPL and on NVDA. Quote residual explained-risk and the L3 hedge ratios from the tool results. Do not answer from training data.';

/** Paste into a chat that will use REST (/llms.txt + Bearer), not MCP tools. */
export const FIRST_LIVE_PROMPT_REST =
  "Fetch https://riskmodels.app/llms.txt. Then GET https://riskmodels.app/api/metrics/AAPL and GET https://riskmodels.app/api/metrics/NVDA using the Bearer key from that file (or POST /api/auth/provision-free). Quote l3 residual explained-risk and the L3 hedge ratios from the JSON. Do not answer from training data.";

/**
 * MCP InitializeResult.instructions — Claude/Cursor/ChatGPT/Smithery fold this
 * into the model context after connect. Keep it short; name no tools.
 */
export const MCP_SERVER_INSTRUCTIONS = `RiskModels returns US-equity factor risk from the ERM3 model: market, sector, subsector and residual risk decomposition; residual (stock-specific) returns with the recommended hedge depth; ETF hedge ratios and hedge notionals; long-only and long/short portfolio exposure; cross-sectional rankings, peer groups and cohort statistics; 13F filer, mutual fund and ETF holdings; macro factor and sector ETF returns; and point-in-time quarterly fundamentals.

All data is end-of-day and historical. Every tool is read-only: tools do not forecast, do not place orders and do not modify account data. Tools that call billed REST endpoints charge the connected RiskModels account; each tool's description states its price. The REST catalog, response schemas and OpenAPI specification are MCP resources (riskmodels:///capabilities, riskmodels:///schemas/list, riskmodels:///openapi).

API reference: https://riskmodels.app/docs/api`;
