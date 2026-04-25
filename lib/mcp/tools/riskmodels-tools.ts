import { readFileSync } from "fs";
import { join } from "path";
import { RiskModelsClient, type PositionInput, type WhitepaperExampleId } from "@riskmodels/sdk";
import { z } from "zod";

type McpContent = { type: "text"; text: string };
type McpToolResult = { content: McpContent[] };
type McpPromptResult = {
  description?: string;
  messages: Array<{ role: "user" | "assistant"; content: McpContent }>;
};

type McpLikeServer = {
  registerTool: (name: string, config: Record<string, unknown>, handler: (args: any) => Promise<McpToolResult>) => void;
  registerResource: (
    name: string,
    uri: string,
    config: Record<string, unknown>,
    handler: (uri: URL) => Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }>,
  ) => void;
  registerPrompt?: (
    name: string,
    config: Record<string, unknown>,
    handler: (args: any) => McpPromptResult | Promise<McpPromptResult>,
  ) => void;
};

const WHITEPAPER_RESOURCES = [
  {
    name: "whitepaper-one-position-four-bets",
    uri: "riskmodels://whitepaper/one-position-four-bets",
    title: "One Position, Four Bets",
    file: "one-position-four-bets.md",
  },
  {
    name: "whitepaper-core-claim",
    uri: "riskmodels://whitepaper/chapter/01-core-claim",
    title: "Core Claim",
    file: "01-core-claim.md",
  },
  {
    name: "whitepaper-aapl-vs-nvda",
    uri: "riskmodels://whitepaper/chapter/02-aapl-vs-nvda",
    title: "AAPL vs NVDA",
    file: "02-aapl-vs-nvda.md",
  },
  {
    name: "whitepaper-hedging",
    uri: "riskmodels://whitepaper/chapter/03-hedging",
    title: "Hedging",
    file: "03-hedging.md",
  },
  {
    name: "example-aapl-nvda-crwd",
    uri: "riskmodels://examples/aapl-nvda-crwd",
    title: "AAPL, NVDA, CRWD Example",
    file: "examples-aapl-nvda-crwd.md",
  },
] as const;

const CHART_INSTRUCTION =
  "If chart_data is present, render the suggested_chart. Use grouped bars for comparisons and bars for single-stock decomposition. Always explain the result in plain English.";

function textResult(payload: unknown): McpToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            chart_instruction: CHART_INSTRUCTION,
            ...((payload && typeof payload === "object" && !Array.isArray(payload))
              ? (payload as Record<string, unknown>)
              : { data: payload }),
          },
          null,
          2,
        ),
      },
    ],
  };
}

function errorResult(error: unknown): McpToolResult {
  return textResult({
    error: error instanceof Error ? error.message : String(error),
  });
}

function readWhitepaperFile(dataDir: string, file: string): string {
  return readFileSync(join(dataDir, "whitepaper", file), "utf-8");
}

function promptText(text: string): McpPromptResult {
  return {
    messages: [{ role: "user", content: { type: "text", text } }],
  };
}

export function createRiskModelsSdk(opts: { apiKey?: string | null; apiBase?: string }): RiskModelsClient {
  const base = (opts.apiBase || "https://riskmodels.app").replace(/\/$/, "");
  return new RiskModelsClient({
    apiKey: opts.apiKey ?? undefined,
    baseUrl: base.endsWith("/api") ? base : `${base}/api`,
  });
}

export function registerRiskModelsTools(
  sdk: Pick<RiskModelsClient, "decompose" | "compare" | "hedgePosition" | "portfolioDecompose" | "whitepaperExample">,
  server: McpLikeServer,
): void {
  server.registerTool(
    "riskmodels_decompose",
    {
      title: "RiskModels Single-Stock Decomposition",
      description:
        "Decompose one stock into market, sector, subsector, and residual risk. Returns chart_data, suggested_chart, plain_english, and reproducible api_call metadata.",
      inputSchema: {
        ticker: z.string().min(1).describe("Ticker symbol, e.g. NVDA or AAPL"),
      },
    },
    async ({ ticker }) => {
      try {
        return textResult(await sdk.decompose(ticker));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_compare",
    {
      title: "RiskModels Multi-Ticker Comparison",
      description:
        "Compare tickers across market, sector, subsector, and residual risk layers. Prefer grouped bar charts when chart_data is present.",
      inputSchema: {
        tickers: z.array(z.string().min(1)).min(2).max(100).describe("Ticker symbols to compare"),
      },
    },
    async ({ tickers }) => {
      try {
        return textResult(await sdk.compare(tickers));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_hedge_position",
    {
      title: "RiskModels Position Hedge",
      description:
        "Scale ETF hedge ratios for a ticker to a dollar position. Returns chart-ready hedge notionals.",
      inputSchema: {
        ticker: z.string().min(1).describe("Ticker symbol, e.g. NVDA"),
        dollars: z.number().positive().describe("Dollar notional of the stock position"),
      },
    },
    async ({ ticker, dollars }) => {
      try {
        return textResult(await sdk.hedgePosition({ ticker, dollars }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_portfolio_decompose",
    {
      title: "RiskModels Portfolio Decomposition",
      description:
        "Decompose a weighted portfolio into market, sector, subsector, and residual risk layers.",
      inputSchema: {
        positions: z
          .array(
            z.object({
              ticker: z.string().min(1),
              weight: z.number().positive().optional(),
              dollars: z.number().positive().optional(),
            }),
          )
          .min(1)
          .max(100)
          .describe("Portfolio positions as ticker plus weight or dollars"),
      },
    },
    async ({ positions }) => {
      try {
        return textResult(await sdk.portfolioDecompose(positions as PositionInput[]));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_whitepaper_example",
    {
      title: "RiskModels Live White-Paper Example",
      description:
        "Run a live example from the RiskModels white paper. Returns chapter text plus SDK/API output with chart_data.",
      inputSchema: {
        exampleId: z
          .enum(["aapl-vs-nvda", "aapl-nvda-crwd", "nvda-10000-hedge", "portfolio-decomposition"])
          .describe("White-paper example id"),
      },
    },
    async ({ exampleId }) => {
      try {
        return textResult(await sdk.whitepaperExample(exampleId as WhitepaperExampleId));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

export function registerRiskModelsWhitepaperResources(server: McpLikeServer, dataDir: string): void {
  for (const resource of WHITEPAPER_RESOURCES) {
    server.registerResource(
      resource.name,
      resource.uri,
      {
        title: resource.title,
        description: "RiskModels live white-paper markdown resource",
        mimeType: "text/markdown",
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: readWhitepaperFile(dataDir, resource.file),
          },
        ],
      }),
    );
  }
}

export function registerRiskModelsPrompts(server: McpLikeServer): void {
  if (!server.registerPrompt) return;

  server.registerPrompt(
    "follow_whitepaper",
    {
      title: "Follow the RiskModels White Paper",
      description: "Run the sequenced live paper flow with chart-ready examples.",
    },
    () =>
      promptText(`Follow the RiskModels white paper and run each live example.

Read these resources in order:
1. riskmodels://whitepaper/one-position-four-bets
2. riskmodels://whitepaper/chapter/01-core-claim
3. riskmodels://whitepaper/chapter/02-aapl-vs-nvda
4. riskmodels://whitepaper/chapter/03-hedging
5. riskmodels://examples/aapl-nvda-crwd

Then call:
1. riskmodels_whitepaper_example with exampleId "aapl-vs-nvda"
2. riskmodels_whitepaper_example with exampleId "aapl-nvda-crwd"
3. riskmodels_whitepaper_example with exampleId "nvda-10000-hedge"
4. riskmodels_whitepaper_example with exampleId "portfolio-decomposition"

${CHART_INSTRUCTION}`),
  );

  server.registerPrompt(
    "reproduce_aapl_nvda",
    {
      title: "Reproduce AAPL vs NVDA",
      description: "Compare AAPL and NVDA using RiskModels and explain the risk layers.",
    },
    () =>
      promptText(
        `Compare AAPL and NVDA using RiskModels. What am I really betting on? Use riskmodels_compare and render a grouped bar chart from chart_data.`,
      ),
  );

  server.registerPrompt(
    "hedge_single_position",
    {
      title: "Hedge a Single Position",
      description: "Scale hedge ratios to a dollar position.",
      argsSchema: {
        ticker: z.string().optional().describe("Ticker to hedge, default NVDA"),
        dollars: z.string().optional().describe("Dollar position, default 10000"),
      },
    },
    ({ ticker, dollars }) =>
      promptText(
        `Use riskmodels_hedge_position to hedge a $${dollars || "10000"} ${ticker || "NVDA"} position. Render the suggested chart and explain the ETF legs in plain English.`,
      ),
  );

  server.registerPrompt(
    "explain_my_portfolio",
    {
      title: "Explain My Portfolio",
      description: "Decompose a portfolio into RiskModels layers.",
    },
    () =>
      promptText(
        `Ask me for tickers and weights or dollar notionals, then call riskmodels_portfolio_decompose. Render chart_data using suggested_chart and explain the market, sector, subsector, and residual risk layers.`,
      ),
  );
}
