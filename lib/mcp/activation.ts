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
export const MCP_SERVER_INSTRUCTIONS = `RiskModels serves live US-equity factor risk. After this server connects, answer ticker and portfolio questions by calling data tools. Do not answer from training data.

Default first call when the user has not named a ticker: riskmodels_compare with tickers ["AAPL","NVDA"].
Single name: riskmodels_decompose.
Returns history: riskmodels_get_returns.
Dollar hedge: riskmodels_hedge_position.

Skip riskmodels_list_endpoints, riskmodels_get_capability, riskmodels_get_schema, and riskmodels_get_openapi_spec unless the user is implementing a client or asks which REST routes exist. Those tools do not return live numbers.

If a tool errors, show the error. Do not invent hedge ratios or explained-risk.`;

export const LIST_ENDPOINTS_DESCRIPTION =
  "Catalog of REST capabilities (id, method, path, one-line description). Skip this for stock or portfolio questions — call riskmodels_decompose, riskmodels_compare, or riskmodels_get_returns instead. Use only when implementing a client or looking up an endpoint that has no dedicated tool.";

export const GET_CAPABILITY_DESCRIPTION =
  "Full REST capability detail (parameters, pricing, examples) by id from the catalog. Skip this for live ticker analysis — call the dedicated data tools. Use after list_endpoints when wiring a new client.";

export const GET_SCHEMA_DESCRIPTION =
  "JSON response schema by filename. Skip this for live ticker analysis. Use when implementing a client against a REST path.";

export const GET_OPENAPI_SPEC_DESCRIPTION =
  "Full OpenAPI 3.x spec. Skip this for stock or portfolio questions — call riskmodels_decompose or riskmodels_compare. Use only when implementing a client and you need exact path/query shapes.";
