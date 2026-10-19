import { describe, expect, it } from "vitest";

import { GET } from "@/app/.well-known/mcp.json/route";
import { buildLlmsTxt } from "@/lib/llms-txt";

describe("Gemini MCP discovery", () => {
  it("publishes the conventional root route and exact protected-resource metadata", async () => {
    const response = await GET();
    const body = (await response.json()) as {
      mcpServers: {
        riskmodels: {
          url: string;
          auth: Array<{ protected_resource?: string }>;
        };
      };
      client_setup: Record<string, string>;
    };

    expect(body.mcpServers.riskmodels.url).toMatch(/\/api\/mcp$/);
    expect(body.mcpServers.riskmodels.auth[0]?.protected_resource).toMatch(
      /\/\.well-known\/oauth-protected-resource\/api\/mcp$/,
    );
    expect(body.client_setup.gemini_spark).toContain("https://riskmodels.app/api/mcp");
    expect(body.client_setup.gemini_cli).toContain("https://riskmodels.app/api/mcp");
  });

  it("names the root route for every Gemini MCP surface in llms.txt", () => {
    const llms = buildLlmsTxt("https://riskmodels.app");

    expect(llms).toContain("| Gemini Spark custom apps | `https://riskmodels.app/api/mcp`");
    expect(llms).toContain("| Gemini CLI | `https://riskmodels.app/api/mcp`");
    expect(llms).toContain("| Gemini Enterprise | `https://riskmodels.app/api/mcp`");
  });
});
