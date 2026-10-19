import { describe, expect, it } from "vitest";

import { GET, OPTIONS } from "@/app/api/mcp/route";
import { GET as getProtectedResourceMetadata } from "@/app/.well-known/oauth-protected-resource/api/mcp/route";

describe("bare MCP route alias", () => {
  it("answers the Streamable HTTP discovery probe", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(await response.text()).toContain("JSON-RPC over POST only");
  });

  it("advertises supported methods for browser clients", async () => {
    const response = await OPTIONS();

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, POST, DELETE, OPTIONS");
  });

  it("publishes resource metadata for the exact alias", async () => {
    const response = await getProtectedResourceMetadata();
    const body = (await response.json()) as { resource: string };

    expect(body.resource).toMatch(/\/api\/mcp$/);
  });
});
