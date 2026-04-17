/**
 * RiskModels API MCP server — stdio entry point.
 *
 * Server construction and tool registrations live in `./server.ts` so the
 * hosted Next.js route (`/api/mcp/sse`) can reuse them. This file wires only
 * the stdio transport.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";

async function main() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
