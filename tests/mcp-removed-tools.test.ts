import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createMcpServer } from "@/lib/mcp/server";
import { REMOVED_TOOLS, installRemovedToolGuidance } from "@/lib/mcp/removed-tools";

/**
 * A client that connected before tool set 2.0 still offers the 1.x names.
 * Calling one must return a tool error naming the replacement, not a bare
 * "not found", and the names must stay out of tools/list.
 */

async function connect(surface: "default" | "openai") {
  const server = createMcpServer({ apiKey: "rm_agent_live_test", surface });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientT);
  return { server, client };
}

describe("MCP removed-tool guidance", () => {
  it("installs on the SDK version in use", () => {
    const server = createMcpServer({ apiKey: "rm_agent_live_test", surface: "default" });
    expect(installRemovedToolGuidance(server)).toBe(true);
  });

  for (const surface of ["default", "openai"] as const) {
    it(`${surface}: removed names are not listed and return guidance when called`, async () => {
      const { client } = await connect(surface);
      const listed = (await client.listTools()).tools.map((t) => t.name);
      for (const name of Object.keys(REMOVED_TOOLS)) expect(listed, name).not.toContain(name);

      const res = await client.callTool({ name: "riskmodels_search_tickers", arguments: { search: "BBBY" } });
      expect(res.isError).toBe(true);
      const text = (res.content as Array<{ text: string }>)[0]!.text;
      expect(text).toContain("riskmodels_search");
      expect(text).toContain("reconnect");
    });

    it(`${surface}: an unknown name still fails as not found`, async () => {
      const { client } = await connect(surface);
      const res = await client.callTool({ name: "riskmodels_no_such_tool", arguments: {} });
      expect(res.isError).toBe(true);
      expect((res.content as Array<{ text: string }>)[0]!.text).toMatch(/not found/);
    });
  }

  it("every removed name appears in the mcp/README.md migration table", () => {
    const readme = readFileSync(join(process.cwd(), "mcp/README.md"), "utf-8");
    const table = readme.slice(readme.indexOf("### Migration from 1.x"));
    for (const name of Object.keys(REMOVED_TOOLS)) expect(table, name).toContain(`\`${name}\``);
  });
});
