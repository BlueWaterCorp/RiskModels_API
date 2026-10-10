/**
 * Post-connect activation copy — SSOT for MCP instructions, first prompts,
 * and discovery-tool descriptions.
 *
 * OAuth/Smithery connect stamps last_used_at without a billed REST call.
 * Catalog tools (list_endpoints, get_capability, get_schema, openapi) are
 * local and free. Agents that start there never hit live data. These strings
 * tell the model to call a data tool first.
 */

/** Paste into Claude/Cursor after the MCP connector is connected. */
export const FIRST_LIVE_PROMPT_MCP =
  'Call riskmodels_compare with tickers ["AAPL","NVDA"]. Then call riskmodels_decompose on AAPL and on NVDA. Quote residual explained-risk and the L3 hedge ratios from the tool results. Do not answer from training data. Do not call riskmodels_list_endpoints unless I ask which REST routes exist.';

/** Paste into a chat that will use REST (/llms.txt + Bearer), not MCP tools. */
export const FIRST_LIVE_PROMPT_REST =
  "Fetch https://riskmodels.app/llms.txt. Then GET https://riskmodels.app/api/metrics/AAPL and GET https://riskmodels.app/api/metrics/NVDA using the Bearer key from that file (or POST /api/auth/provision-free). Quote l3 residual explained-risk and the L3 hedge ratios from the JSON. Do not answer from training data.";

/**
 * MCP InitializeResult.instructions — Claude/Cursor/Smithery fold this into
 * the model context after connect. Keep it short.
 */
export const MCP_SERVER_INSTRUCTIONS = `RiskModels returns US-equity factor risk from the ERM3 model: market, sector, subsector and residual risk decomposition; ETF hedge ratios and hedge notionals; long-only and long/short portfolio exposure; cross-sectional rankings and cohort statistics; 13F filer, mutual fund and ETF holdings; and point-in-time quarterly fundamentals.

All data is end-of-day and historical. Tools do not forecast and do not place orders. Tools that call billed REST endpoints charge the connected RiskModels account; each such tool's description states its price. The catalog tools (riskmodels_list_endpoints, riskmodels_get_capability, riskmodels_get_schema) read a static catalog and return no market data.

API reference: https://riskmodels.app/docs/api`;

export const LIST_ENDPOINTS_DESCRIPTION =
  "Lists the RiskModels REST catalog: capability id, HTTP method, path and a one-line description for each endpoint. Reads a static catalog and returns no market data. Free. API reference: https://riskmodels.app/docs/api";

export const GET_CAPABILITY_DESCRIPTION =
  "Returns one REST capability's full definition by id: parameters, pricing and examples. Reads a static catalog and returns no market data. Free. API reference: https://riskmodels.app/docs/api";

export const GET_SCHEMA_DESCRIPTION =
  "Returns the JSON response schema for one REST endpoint by schema filename (for example ticker-returns-v2.json). Static; free. API reference: https://riskmodels.app/docs/api";

export const GET_OPENAPI_SPEC_DESCRIPTION =
  "Returns the full OpenAPI 3 specification of the RiskModels REST API. Static; free. API reference: https://riskmodels.app/docs/api";
