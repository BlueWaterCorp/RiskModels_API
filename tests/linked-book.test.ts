import { describe, expect, it } from "vitest";
import { z } from "zod";
import { shapeLinkedBook } from "../lib/mcp/tools/linked-book";
import { registerRiskModelsTools } from "../lib/mcp/tools/riskmodels-tools";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type ToolHandler = (args: unknown) => Promise<{ content: Array<{ type: "text"; text: string }> }>;

function registerAll(opts: {
  apiKey?: string | null;
  fetchPositions?: typeof fetch;
  call?: (method: string, path: string, init?: unknown) => Promise<unknown>;
}) {
  const tools = new Map<string, ToolHandler>();
  const configs = new Map<string, Record<string, unknown>>();
  const server = {
    registerTool: (name: string, config: Record<string, unknown>, handler: ToolHandler) => {
      tools.set(name, handler);
      configs.set(name, config);
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
    call: opts.call ?? (async () => ({})),
  };
  registerRiskModelsTools(sdk as never, server as never, {
    apiKey: opts.apiKey,
    portalBase: "https://portal.test",
    fetchPositions: opts.fetchPositions,
  });
  return { tools, configs };
}

function toolHarness(opts: { apiKey?: string | null; fetchPositions?: typeof fetch }) {
  return registerAll(opts).tools.get("riskmodels_get_my_positions")!;
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
    expect(book.excluded[0].reason).toContain("riskmodels_portfolio_exposure");
    expect(book.empty).toBe(false);
  });

  it("keeps shorts signed in for_exposure and flags has_shorts", () => {
    const book = shapeLinkedBook({
      positions: [
        { ticker: "aapl", quantity: 10, market_value: 1000, weight: 1.1 },
        { ticker: "tsla", quantity: -2, market_value: -100, weight: -0.1 },
        { ticker: "flat", quantity: 0, market_value: 0, weight: 0 },
        { ticker: "xyz", quantity: 1, market_value: null, weight: null },
      ],
    });
    expect(book.for_exposure).toEqual([
      { ticker: "AAPL", value: 1000 },
      { ticker: "TSLA", value: -100 },
    ]);
    expect(book.has_shorts).toBe(true);
  });

  it("reports has_shorts false for a long-only book", () => {
    const book = shapeLinkedBook({
      positions: [{ ticker: "AAPL", quantity: 1, market_value: 200, weight: 1 }],
    });
    expect(book.has_shorts).toBe(false);
    expect(book.for_exposure).toEqual([{ ticker: "AAPL", value: 200 }]);
  });
});

describe("riskmodels_portfolio_exposure", () => {
  const inputSchema = () =>
    z.object(
      registerAll({}).configs.get("riskmodels_portfolio_exposure")!.inputSchema as z.ZodRawShape,
    );

  it("accepts negative values and rejects zero or more than 1000 positions", () => {
    const schema = inputSchema();
    expect(
      schema.safeParse({ positions: [{ ticker: "AAPL", value: 1000 }, { ticker: "TSLA", value: -500 }] }).success,
    ).toBe(true);
    expect(schema.safeParse({ positions: [{ ticker: "AAPL", value: 0 }] }).success).toBe(false);
    const tooMany = Array.from({ length: 1001 }, (_, i) => ({ ticker: `T${i}`, value: i % 2 ? 1 : -1 }));
    expect(schema.safeParse({ positions: tooMany }).success).toBe(false);
    expect(schema.safeParse({ positions: [] }).success).toBe(false);
  });

  it("posts the signed book to /portfolio/exposure", async () => {
    const calls: Array<{ method: string; path: string; init: unknown }> = [];
    const { tools } = registerAll({
      call: async (method, path, init) => {
        calls.push({ method, path, init });
        return { coverage: { dropped: [] } };
      },
    });
    const result = await tools.get("riskmodels_portfolio_exposure")!({
      positions: [
        { ticker: "aapl", value: 1000 },
        { ticker: "TSLA", value: -500 },
      ],
      hedge_level: "l2",
      lookback_days: 126,
      as_of: "2026-06-30",
    });
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/portfolio/exposure",
        init: {
          body: {
            positions: [
              { ticker: "AAPL", value: 1000 },
              { ticker: "TSLA", value: -500 },
            ],
            hedge_level: "l2",
            lookback_days: 126,
            as_of: "2026-06-30",
          },
        },
      },
    ]);
    expect(JSON.parse(result.content[0].text).coverage).toEqual({ dropped: [] });
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
    expect(payload.has_shorts).toBe(false);
  });

  it("routes a book with shorts to riskmodels_portfolio_exposure", async () => {
    const handler = toolHarness({
      apiKey: "rm_agent_live_test",
      fetchPositions: async () =>
        jsonResponse(200, {
          positions: [
            { ticker: "AAPL", quantity: 4, market_value: 1000, weight: 2 },
            { ticker: "TSLA", quantity: -2, market_value: -500, weight: -1 },
          ],
        }),
    });
    const payload = JSON.parse((await handler({})).content[0].text);
    expect(payload.has_shorts).toBe(true);
    expect(payload.for_exposure).toEqual([
      { ticker: "AAPL", value: 1000 },
      { ticker: "TSLA", value: -500 },
    ]);
    expect(payload.next_step).toContain("riskmodels_portfolio_exposure");
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
