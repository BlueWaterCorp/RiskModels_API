import { describe, expect, it } from "vitest";
import { shapeLinkedBook } from "../lib/mcp/tools/linked-book";
import { registerRiskModelsTools } from "../lib/mcp/tools/riskmodels-tools";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function toolHarness(opts: {
  apiKey?: string | null;
  fetchPositions?: typeof fetch;
}) {
  const tools = new Map<string, (args: unknown) => Promise<{ content: Array<{ type: "text"; text: string }> }>>();
  const server = {
    registerTool: (name: string, _config: Record<string, unknown>, handler: (args: unknown) => Promise<{ content: Array<{ type: "text"; text: string }> }>) => {
      tools.set(name, handler);
    },
    registerResource: () => undefined,
  };
  const sdk = {
    decompose: async () => ({}),
    getHedgeLevels: async () => ({}),
    compare: async () => ({}),
    hedgePosition: async () => ({}),
    analyzePortfolio: async () => ({}),
    hedgePortfolio: async () => ({}),
    portfolioDecompose: async () => ({}),
    whitepaperExample: async () => ({}),
    getReturns: async () => ({}),
    getReturnAttribution: async () => ({}),
    call: async () => ({}),
  };
  registerRiskModelsTools(sdk as never, server as never, {
    apiKey: opts.apiKey,
    portalBase: "https://portal.test",
    fetchPositions: opts.fetchPositions,
  });
  return tools.get("riskmodels_get_my_positions")!;
}

describe("shapeLinkedBook", () => {
  it("splits a long book from a short and a nameless row", () => {
    const book = shapeLinkedBook({
      portfolio_id: "port-1",
      total_market_value: 900,
      positions: [
        { ticker: "aapl", quantity: 10, market_value: 1000, weight: 1.1 },
        { ticker: "tsla", quantity: -2, market_value: -100, weight: -0.1 },
        { ticker: "   ", quantity: 1, market_value: 1, weight: 0.01 },
        { ticker: "xyz", quantity: 1, market_value: null, weight: null },
      ],
    });
    expect(book.n_positions).toBe(3);
    expect(book.for_analysis).toEqual([{ ticker: "AAPL", weight: 1.1 }]);
    expect(book.for_hedge).toEqual([{ ticker: "AAPL", dollars: 1000 }]);
    expect(book.excluded.map((row) => row.ticker)).toEqual(["TSLA", "XYZ"]);
    expect(book.empty).toBe(false);
  });
});

describe("riskmodels_get_my_positions", () => {
  it("returns the book and the next tool call when the portal has positions", async () => {
    const calls: string[] = [];
    const handler = toolHarness({
      apiKey: "rm_agent_live_test",
      fetchPositions: async (url, init) => {
        calls.push(String(url));
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer rm_agent_live_test");
        return jsonResponse(200, {
          portfolio_id: "port-1",
          total_market_value: 1000,
          positions: [{ ticker: "AAPL", quantity: 4, market_value: 1000, weight: 1 }],
        });
      },
    });
    const result = await handler({});
    const payload = JSON.parse(result.content[0].text);
    expect(calls).toEqual(["https://portal.test/api/positions"]);
    expect(payload.for_analysis).toEqual([{ ticker: "AAPL", weight: 1 }]);
    expect(payload.for_hedge).toEqual([{ ticker: "AAPL", dollars: 1000 }]);
    expect(payload.next_step).toContain("riskmodels_analyze_portfolio");
    expect(payload.next_step).toContain("does not place orders");
  });

  it("tells the caller to sync when the book is empty", async () => {
    const handler = toolHarness({
      apiKey: "rm_agent_live_test",
      fetchPositions: async () => jsonResponse(200, { positions: [] }),
    });
    const payload = JSON.parse((await handler({})).content[0].text);
    expect(payload.empty).toBe(true);
    expect(payload.message).toContain("Sync positions");
  });

  it("reports a missing key without calling the portal", async () => {
    let called = false;
    const handler = toolHarness({
      apiKey: null,
      fetchPositions: async () => {
        called = true;
        return jsonResponse(200, { positions: [] });
      },
    });
    const payload = JSON.parse((await handler({})).content[0].text);
    expect(called).toBe(false);
    expect(payload.error).toContain("RISKMODELS_API_KEY");
  });

  it("surfaces a rejected key", async () => {
    const handler = toolHarness({
      apiKey: "rm_agent_live_test",
      fetchPositions: async () => jsonResponse(401, { error: "Unauthorized" }),
    });
    const payload = JSON.parse((await handler({})).content[0].text);
    expect(payload.status).toBe(401);
    expect(payload.error).toContain("rejected");
  });
});
