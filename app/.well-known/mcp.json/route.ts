import { NextResponse } from "next/server";
import { getAppUrl } from "@/lib/app-url";
import { FIRST_LIVE_PROMPT_MCP } from "@/lib/mcp/activation";

export const dynamic = "force-dynamic";

/**
 * GET /.well-known/mcp.json — MCP discovery manifest (site origin, not under /api).
 */
export async function GET() {
  const base = getAppUrl().replace(/\/$/, "");
  const sseUrl = `${base}/api/mcp/sse`;
  const payload = {
    mcpServers: {
      riskmodels: {
        name: "RiskModels API",
        description:
          "Clean dividend-adjusted US equity total returns, factor risk decomposition, return attribution, and ETF hedge ratios.",
        url: sseUrl,
        transport: "streamable-http",
        auth: [
          {
            type: "oauth2",
            protected_resource: `${base}/.well-known/oauth-protected-resource`,
            authorization_server: `${base}/.well-known/oauth-authorization-server`,
            scopes: ["mcp:read"],
            note: "Preferred for Claude Desktop, Cursor, and ChatGPT Developer Mode connectors",
          },
          {
            type: "bearer",
            header: "Authorization",
            prefix: "Bearer ",
            note: "For mcp-remote, curl, or agents with a personal API key",
          },
        ],
        capabilities: {
          tools: true,
          resources: true,
        },
      },
    },
    documentation_url: `${base}/docs/agent-integration`,
    llms_txt: `${base}/llms.txt`,
    first_prompt: FIRST_LIVE_PROMPT_MCP,
    after_connect:
      "Paste first_prompt into the chat. Call data tools (riskmodels_compare / riskmodels_decompose). Do not start with list_endpoints.",
    client_setup: {
      claude_desktop_cursor:
        "Settings → Connectors → Add custom connector → paste MCP URL → OAuth sign-in (leave client id/secret blank)",
      claude_code_plugin:
        "claude plugin marketplace add BlueWaterCorp/riskmodels-plugin && claude plugin install riskmodels@riskmodels (set RISKMODELS_API_KEY for CLI Bearer, or use OAuth connector and keep one MCP connection)",
      chatgpt:
        "Settings → Apps & Connectors → Advanced → enable Developer mode → Create → paste MCP URL → OAuth sign-in (Plus+ web; not the Finances/Schwab connector)",
      grok:
        "grok.com/connectors → New Connector → Custom → paste MCP URL → OAuth sign-in (web, iOS, Android)",
      gemini_consumer_web:
        "No custom MCP UI — use llms.txt + REST in chat, or get-key for full universe",
      gemini_cli:
        "gemini mcp add --transport http riskmodels https://riskmodels.app/api/mcp/sse then /mcp auth riskmodels",
      gemini_enterprise:
        "Google Cloud admin: Custom MCP Server data store; Streamable HTTP URL + OAuth (Client ID/Secret may need POST /api/oauth/register)",
      cli: "RISKMODELS_API_KEY=… npx -y riskmodels@latest install",
    },
    plugin: {
      marketplace_github: "https://github.com/BlueWaterCorp/riskmodels-plugin",
      install: [
        "claude plugin marketplace add BlueWaterCorp/riskmodels-plugin",
        "claude plugin install riskmodels@riskmodels",
      ],
      setup_md:
        "https://github.com/BlueWaterCorp/riskmodels-plugin/blob/main/plugins/riskmodels/SETUP.md",
    },
    privacy_url: "https://riskmodels.app/privacy",
    privacy_canonical_url: "https://riskmodels.net/privacy",
    _documentation: {
      note: "Use POST on the MCP Streamable HTTP endpoint with Accept: application/json, text/event-stream",
      sse_post: sseUrl,
      chatgpt_finances_note:
        "ChatGPT Finances/Schwab is a separate connector. Combine holdings from Finances with RiskModels REST or add this MCP server via Developer Mode.",
    },
  };
  return NextResponse.json(payload, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
  });
}
