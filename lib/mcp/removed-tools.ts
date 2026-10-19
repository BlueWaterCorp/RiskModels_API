/**
 * Guidance for tool names removed in MCP tool set 2.0 (#467, 2026-10-15).
 *
 * A client keeps the tool list it fetched when it connected, so a session that
 * connected before a rename still offers the old names. The SDK answers a call
 * to an unregistered name with a bare `-32602 Tool X not found`, which leaves
 * the model nothing to act on. For the names below we instead return a normal
 * tool error naming the replacement, so the model can switch tools in the same
 * session. The names stay out of `tools/list`.
 *
 * Keep in step with the "Migration from 1.x" table in mcp/README.md.
 */
import { CallToolRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const REMOVED_TOOLS: Record<string, string> = {
  get_metrics: "Use `riskmodels_get_stock_snapshot` (same GET /metrics/{ticker}).",
  riskmodels_get_hedge_levels: "Use `riskmodels_get_stock_snapshot`; `hedge_levels` is a block of its response.",
  riskmodels_hedge_position: "Use `riskmodels_decompose` with `dollars`.",
  get_l3_decomposition: "Use `riskmodels_get_returns` (daily L3 hedge ratios and explained risk) or `riskmodels_get_return_attribution`.",
  riskmodels_get_lstar: "Use `riskmodels_get_residual_returns` with `tickers: [\"<TICKER>\"]`.",
  riskmodels_batch_lstar: "Use `riskmodels_get_residual_returns` with 2-100 tickers.",
  riskmodels_get_residual_returns_batch: "Use `riskmodels_get_residual_returns` with 2-100 tickers.",
  get_fundamentals: "Use `riskmodels_get_fundamentals` (same route and parameters).",
  riskmodels_hedge_portfolio: "Use `riskmodels_analyze_portfolio` with dollar positions.",
  post_snapshot: "Use `riskmodels_get_portfolio_risk_snapshot` (`portfolio` is now `positions`).",
  riskmodels_portfolio_decompose: "Use `riskmodels_get_portfolio_risk_snapshot`.",
  get_portfolio_risk_snapshot: "Use `riskmodels_get_portfolio_risk_snapshot`.",
  riskmodels_search_tickers: "Use `riskmodels_search` with `type: \"stock\"` (`search` is now `q`).",
  riskmodels_search_etfs: "Use `riskmodels_search` with `type: \"etf\"`.",
  riskmodels_search_filers: "Use `riskmodels_search` with `type: \"filer\"`.",
  riskmodels_search_funds: "Use `riskmodels_search` with `type: \"fund\"`.",
  riskmodels_get_filer_snapshot: "Use `riskmodels_get_filer`.",
  riskmodels_get_filer_holdings: "Use `riskmodels_get_filer` with `holdings_top`.",
  riskmodels_get_fund_snapshot: "Use `riskmodels_get_fund`.",
  riskmodels_get_fund_holdings: "Use `riskmodels_get_fund` with `holdings_limit`.",
  riskmodels_get_etf_holdings: "Use `riskmodels_get_etf` with `holdings_top`.",
  riskmodels_get_macro_factor_returns: "Use `riskmodels_get_factor_returns` with `kind: \"macro\"`.",
  riskmodels_get_sector_etf_returns: "Use `riskmodels_get_factor_returns` with `kind: \"sector_etf\"`.",
  riskmodels_call_endpoint: "Removed. The fund, peer and factor routes it reached now have explicit tools.",
  riskmodels_list_endpoints: "Removed. Read the resource `riskmodels:///capabilities`.",
  riskmodels_get_capability: "Removed. Read the resource `riskmodels:///capabilities`.",
  riskmodels_get_schema: "Removed. Read `riskmodels:///schemas/list`, then `riskmodels:///schemas/{path}`.",
  riskmodels_get_openapi_spec: "Removed. Read the resource `riskmodels:///openapi`.",
  riskmodels_whitepaper_example: "Removed. Use the `follow_whitepaper` prompt.",
};

export function removedToolResult(name: string): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text:
          `\`${name}\` was removed in RiskModels MCP tool set 2.0 (2026-10-15). ${REMOVED_TOOLS[name]} ` +
          "Your client is using a tool list from before that change; reconnect the RiskModels server " +
          "(or update the plugin) to refresh it.",
      },
    ],
  };
}

type Handler = (request: { params: { name: string } }, extra: unknown) => unknown;

/**
 * Wrap the SDK's tools/call handler. Call after every tool is registered.
 * Returns false when the SDK internals differ (the test pins it to true).
 */
export function installRemovedToolGuidance(server: McpServer): boolean {
  const handlers = (server.server as unknown as { _requestHandlers?: Map<string, Handler> })._requestHandlers;
  const original = handlers?.get("tools/call");
  if (!original) return false;
  server.server.setRequestHandler(CallToolRequestSchema, (request, extra) => {
    const name = request.params.name;
    if (Object.hasOwn(REMOVED_TOOLS, name) && !(server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools[name]) {
      return removedToolResult(name);
    }
    return original(request, extra) as ReturnType<Handler> as never;
  });
  return true;
}
