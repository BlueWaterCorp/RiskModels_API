# Chat Integration Implementation Plan

**For: Cursor agent execution**
**Context: Read `PREMIUM_TIER_DESIGN.md` for pricing context. Chat is a premium endpoint ($0.001/$0.002 per 1K tokens).**

---

## Current State

The chat endpoint (`POST /api/chat`, `app/api/chat/route.ts`) is a **thin OpenAI pass-through**:

- Accepts `messages` array, optional `model` (default `gpt-4o-mini`), optional `response_mode` (unused)
- Prepends a static `SYSTEM_PROMPT` that describes ERM3 concepts
- Calls `openai.chat.completions.create()` with no tools/functions
- Returns the assistant message, token usage, `_metadata` (lineage), and `_agent` (cost, request_id, latency)
- Billed per-token via `withBilling()` with `getTokenEstimates` for pre-flight cost estimation
- **Cannot call any RiskModels API endpoints** — if a user asks "what's NVDA's hedge ratio?", the LLM can only describe what a hedge ratio is, not fetch the actual number

The `response_mode` parameter (`markdown | catalog | hybrid`) is defined in the schema but **not implemented** — the route ignores it. The A2UI catalog referenced in capabilities.ts descriptions lives in Risk_Models (the riskmodels.net app), not in RiskModels_API.

---

## Goal

Turn the chat endpoint into an **agentic risk analyst** that can:

1. **Call RiskModels API endpoints** as OpenAI function calls (tools) to fetch live data
2. **Stream responses** via SSE for real-time UX
3. **Report accurate per-tool costs** — each internal API call has its own `cost_usd`; the chat response should report total cost (LLM tokens + tool call costs)
4. **Stay within the existing billing model** — chat is premium per-token; internal tool calls should be billed at their standard rates and the total rolled up

---

## Architecture

```
Client  ──POST /api/chat──▶  Chat Route
                                │
                          ┌─────▼─────┐
                          │  OpenAI   │
                          │  GPT-4o   │◄──── tools[] definition
                          └─────┬─────┘
                                │ tool_calls
                          ┌─────▼─────┐
                          │  Tool     │──▶ GET /api/metrics/NVDA (internal, billed)
                          │  Executor │──▶ POST /api/correlation (internal, billed)
                          │           │──▶ POST /api/portfolio/risk-index (internal, billed)
                          └─────┬─────┘
                                │ tool results
                          ┌─────▼─────┐
                          │  OpenAI   │
                          │  (cont.)  │──▶ final assistant message
                          └─────┬─────┘
                                │
Client  ◀──JSON/SSE────────────┘
```

Internal tool calls go through the **same data access layer** (DAL) functions used by the API routes, but **bypass HTTP** — they call the DAL directly. Billing for each tool call is recorded as a separate `billing_event` using `deductBalance()` directly, so the user sees itemized costs.

---

## Phase 1: Define tool schemas for OpenAI function calling

### Step 1.1 — Create `lib/chat/tools.ts`

Define the OpenAI-compatible tool schemas. These map to existing RiskModels API capabilities:

```typescript
import type { ChatCompletionTool } from "openai/resources/chat/completions";

export const CHAT_TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_risk_metrics",
      description:
        "Fetch latest hedge ratios (L1/L2/L3), explained risk, volatility, and price for a US equity ticker.",
      parameters: {
        type: "object",
        properties: {
          ticker: {
            type: "string",
            description: "Stock ticker symbol (e.g. AAPL, NVDA, TSLA)",
          },
        },
        required: ["ticker"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_l3_decomposition",
      description:
        "Decompose a stock's risk into market, sector, and subsector components using the ERM3 L3 model. Returns explained risk fractions and hedge ratios at each level.",
      parameters: {
        type: "object",
        properties: {
          ticker: { type: "string", description: "Stock ticker symbol" },
          market_factor_etf: {
            type: "string",
            description: "Market factor ETF (default SPY)",
            default: "SPY",
          },
        },
        required: ["ticker"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_ticker_returns",
      description:
        "Retrieve daily returns with L1/L2/L3 hedge ratios for a ticker. Use for time-series analysis or charting historical risk.",
      parameters: {
        type: "object",
        properties: {
          ticker: { type: "string", description: "Stock ticker symbol" },
          years: {
            type: "integer",
            description: "Years of history (1-15, default 1)",
            default: 1,
          },
        },
        required: ["ticker"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_rankings",
      description:
        "Get cross-sectional percentile rankings for a ticker across its sector and universe. rank_percentile 100 = best.",
      parameters: {
        type: "object",
        properties: {
          ticker: { type: "string", description: "Stock ticker symbol" },
        },
        required: ["ticker"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_factor_correlation",
      description:
        "Compute correlation between a stock's returns and macro factors (bitcoin, gold, oil, dxy, vix, ust10y2y). Use to measure macro exposure.",
      parameters: {
        type: "object",
        properties: {
          ticker: { type: "string", description: "Stock ticker symbol" },
          factors: {
            type: "array",
            items: { type: "string" },
            description:
              "Macro factor keys (bitcoin, gold, oil, dxy, vix, ust10y2y). Default: all six.",
          },
          return_type: {
            type: "string",
            enum: ["gross", "l1", "l2", "l3_residual"],
            description: "Return series type for correlation (default l3_residual)",
            default: "l3_residual",
          },
          window_days: {
            type: "integer",
            description: "Trailing observation window (20-2000, default 252)",
            default: 252,
          },
        },
        required: ["ticker"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_macro_factors",
      description:
        "Fetch daily macro factor total return series (bitcoin, gold, oil, dxy, vix, ust10y2y). No stock ticker needed — pure macro data.",
      parameters: {
        type: "object",
        properties: {
          factors: {
            type: "string",
            description:
              "Comma-separated factor keys. Default: all six.",
          },
          start: {
            type: "string",
            description: "Start date YYYY-MM-DD (default: 5 years before end)",
          },
          end: {
            type: "string",
            description: "End date YYYY-MM-DD (default: today)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_tickers",
      description:
        "Search for tickers by symbol or company name. Use when the user mentions a company name instead of a ticker symbol.",
      parameters: {
        type: "object",
        properties: {
          search: {
            type: "string",
            description: "Search query (ticker symbol or company name)",
          },
          include_metadata: {
            type: "boolean",
            description: "Include company name, sector info",
            default: true,
          },
        },
        required: ["search"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compute_portfolio_risk_index",
      description:
        "Compute Portfolio Risk Index (PRI) — absolute portfolio-level risk via variance decomposition. Use when the user provides multiple positions and wants aggregate risk analysis.",
      parameters: {
        type: "object",
        properties: {
          positions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                ticker: { type: "string" },
                weight: { type: "number" },
              },
              required: ["ticker", "weight"],
            },
            description:
              "Portfolio positions as { ticker, weight } pairs (weights should sum to ~1.0)",
          },
          timeSeries: {
            type: "boolean",
            description: "Return PRI time series (default false)",
            default: false,
          },
        },
        required: ["positions"],
      },
    },
  },
];
```

### Step 1.2 — Create tool name → capability ID mapping

```typescript
/** Maps OpenAI function name → RiskModels capability ID for billing */
export const TOOL_CAPABILITY_MAP: Record<string, string> = {
  get_risk_metrics: "metrics",
  get_l3_decomposition: "l3-decomposition",
  get_ticker_returns: "ticker-returns",
  get_rankings: "rankings",
  get_factor_correlation: "factor-correlation",
  get_macro_factors: "macro-factor-series",
  search_tickers: "ticker-search",
  compute_portfolio_risk_index: "portfolio-risk-index",
};
```

---

## Phase 2: Build tool executor with internal billing

### Step 2.1 — Create `lib/chat/tool-executor.ts`

This module executes tool calls by calling the DAL directly (no HTTP round-trip) and records billing for each call.

```typescript
import { deductBalance } from "@/lib/agent/billing";
import { calculateRequestCost, getCapabilityById } from "@/lib/agent/capabilities";
import { TOOL_CAPABILITY_MAP } from "./tools";

export interface ToolCallResult {
  name: string;
  result: unknown;
  cost_usd: number;
  capability_id: string;
  latency_ms: number;
  error?: string;
}

export async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  userId: string,
  requestId: string,
): Promise<ToolCallResult> {
  const capabilityId = TOOL_CAPABILITY_MAP[toolName];
  if (!capabilityId) {
    return {
      name: toolName,
      result: { error: `Unknown tool: ${toolName}` },
      cost_usd: 0,
      capability_id: "unknown",
      latency_ms: 0,
      error: `Unknown tool: ${toolName}`,
    };
  }

  const start = performance.now();
  let result: unknown;
  let costUsd = 0;

  try {
    // Calculate cost for this tool call
    const itemCount = toolName === "compute_portfolio_risk_index"
      ? (args.positions as unknown[])?.length ?? 1
      : undefined;
    costUsd = calculateRequestCost(capabilityId, undefined, undefined, itemCount);

    // Deduct balance for internal tool call
    await deductBalance(userId, costUsd, requestId, capabilityId);

    // Execute the actual data fetch via DAL (see Step 2.2)
    result = await executeDALCall(toolName, args);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Tool execution failed";
    result = { error: msg };
    // Don't charge for failed calls — refund logic or skip deduct
    costUsd = 0;
  }

  return {
    name: toolName,
    result,
    cost_usd: costUsd,
    capability_id: capabilityId,
    latency_ms: Math.round(performance.now() - start),
  };
}
```

### Step 2.2 — Implement `executeDALCall` dispatch

Each tool maps to an existing DAL function. Import and call them directly:

```typescript
import { getRiskEngineMetrics } from "@/lib/dal/risk-engine-v3";
import { getMacroFactors } from "@/lib/dal/macro-factors";
// ... other DAL imports

async function executeDALCall(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case "get_risk_metrics": {
      const ticker = String(args.ticker).toUpperCase();
      return await getRiskEngineMetrics(ticker);
    }
    case "get_l3_decomposition": {
      const ticker = String(args.ticker).toUpperCase();
      // Call the L3 decomposition logic directly
      // Import from wherever the route handler sources its data
      return await getL3Decomposition(ticker, String(args.market_factor_etf || "SPY"));
    }
    case "get_ticker_returns": {
      const ticker = String(args.ticker).toUpperCase();
      const years = Number(args.years) || 1;
      return await getTickerReturns(ticker, years);
    }
    case "get_rankings": {
      const ticker = String(args.ticker).toUpperCase();
      return await getRankings(ticker);
    }
    case "get_factor_correlation": {
      // Use the factor correlation service
      return await computeFactorCorrelation(args);
    }
    case "get_macro_factors": {
      return await getMacroFactors(args);
    }
    case "search_tickers": {
      return await searchTickers(String(args.search), Boolean(args.include_metadata));
    }
    case "compute_portfolio_risk_index": {
      return await computePortfolioRiskIndex(args);
    }
    default:
      throw new Error(`Unhandled tool: ${toolName}`);
  }
}
```

**Important:** For each case, import the actual DAL function used by the corresponding API route handler. Look at each route file to find the correct import:

- `app/api/metrics/[ticker]/route.ts` → find how it fetches metrics
- `app/api/l3-decomposition/route.ts` → find the decomposition function
- `app/api/ticker-returns/route.ts` → find the returns query
- `app/api/rankings/[ticker]/route.ts` → find rankings logic
- `app/api/correlation/route.ts` → find factor correlation service
- `app/api/macro-factors/route.ts` → find macro factors query
- `app/api/tickers/route.ts` → find ticker search
- `app/api/portfolio/risk-index/route.ts` → find PRI computation

Each route handler already has the DAL call — extract and reuse it. Do NOT make internal HTTP requests to the API routes.

---

## Phase 3: Rewrite the chat route with tool-use loop

### Step 3.1 — Replace `app/api/chat/route.ts`

The new route implements the standard OpenAI tool-use loop:

1. Send user messages + tool definitions to OpenAI
2. If OpenAI returns `tool_calls`, execute each via `executeToolCall`
3. Append tool results to the message history
4. Call OpenAI again with the tool results
5. Repeat until OpenAI returns a final assistant message (no more tool_calls)
6. Return the final message + accumulated costs

```typescript
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getCorsHeaders } from "@/lib/cors";
import { ChatPostSchema } from "@/lib/api/schemas";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import { CHAT_TOOLS } from "@/lib/chat/tools";
import { executeToolCall, ToolCallResult } from "@/lib/chat/tool-executor";

export const dynamic = "force-dynamic";

const DEFAULT_MODEL = "gpt-4o-mini";
const MAX_TOOL_ROUNDS = 5; // safety limit on tool-call loops

const SYSTEM_PROMPT = `You are the RiskModels AI Risk Analyst — a premium endpoint on the RiskModels API (riskmodels.app). You have tools to fetch live US equity factor risk data from the ERM3 model.

Key concepts you work with:
- Hedge Ratios (HR): dollars of ETF to trade per $1 of stock (L1 = market only, L2 = market+sector, L3 = market+sector+subsector)
- Explained Risk (ER): variance fractions showing how much risk each factor explains (L3: market + sector + subsector + residual ≈ 1.0)
- Portfolio Risk Index (PRI): absolute portfolio-level annualized volatility via variance decomposition
- Macro factor correlations: exposure to bitcoin, gold, oil, DXY, VIX, US treasury spread

Guidelines:
- Always fetch live data using your tools before answering questions about specific tickers or portfolios. Do not invent figures.
- When the user mentions a company name, use search_tickers first to resolve the ticker.
- For portfolio questions with multiple positions, use compute_portfolio_risk_index for aggregate risk.
- Be concise. Lead with the numbers, then explain.
- When presenting hedge ratios, specify the ETF legs (e.g. "Short $0.85 of SPY per $1 of NVDA at L1").
- If residual_er > 50%, note that the stock's risk is predominantly idiosyncratic (stock-picking risk, not hedgeable with ETFs).
- Report the total cost of tool calls at the end of your response.`;

async function estimateChatTokens(req: NextRequest) {
  const clone = req.clone();
  let body: unknown;
  try {
    body = await clone.json();
  } catch {
    return { inputTokens: 500, outputTokens: 1500 };
  }
  const parsed = ChatPostSchema.safeParse(body);
  if (!parsed.success) {
    return { inputTokens: 500, outputTokens: 1500 };
  }
  let chars = 0;
  for (const m of parsed.data.messages) {
    chars += m.content.length;
  }
  // Higher estimate to account for tool-call rounds
  const inputTokens = Math.min(100_000, Math.max(500, Math.ceil(chars / 3) + 1000));
  const outputTokens = 2000;
  return { inputTokens, outputTokens };
}

export const POST = withBilling(
  async (request: NextRequest, context: BillingContext) => {
    const origin = request.headers.get("origin");

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Service unavailable", message: "AI chat is not configured" },
        { status: 503, headers: getCorsHeaders(origin) },
      );
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body", message: "Expected JSON body" },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const validation = ChatPostSchema.safeParse(raw);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request", message: validation.error.issues[0]?.message ?? "Validation failed" },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const { messages: userMessages, model: modelOpt } = validation.data;
    const model = modelOpt?.trim() || DEFAULT_MODEL;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const fetchStart = performance.now();

    // Build message history with system prompt
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...userMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    // Tool-use loop
    const toolCallResults: ToolCallResult[] = [];
    let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    let finalContent = "";
    let finalModel = model;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let completion;
      try {
        completion = await openai.chat.completions.create({
          model,
          messages,
          tools: CHAT_TOOLS,
          tool_choice: round === 0 ? "auto" : "auto",
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "OpenAI request failed";
        console.error("[chat]", e);
        return NextResponse.json(
          { error: "Upstream AI error", message: msg },
          { status: 502, headers: getCorsHeaders(origin) },
        );
      }

      // Accumulate token usage across rounds
      if (completion.usage) {
        totalUsage.prompt_tokens += completion.usage.prompt_tokens;
        totalUsage.completion_tokens += completion.usage.completion_tokens;
        totalUsage.total_tokens += completion.usage.total_tokens;
      }
      finalModel = completion.model;

      const choice = completion.choices[0];
      if (!choice) break;

      const assistantMessage = choice.message;
      // Add assistant message to history (includes any tool_calls)
      messages.push(assistantMessage);

      // If no tool calls, we have our final answer
      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        finalContent = assistantMessage.content ?? "";
        break;
      }

      // Execute each tool call
      for (const toolCall of assistantMessage.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch {
          args = {};
        }

        const result = await executeToolCall(
          toolCall.function.name,
          args,
          context.userId,
          context.requestId,
        );
        toolCallResults.push(result);

        // Add tool result to message history for next OpenAI round
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result.result),
        });
      }
    }

    const latency = Math.round(performance.now() - fetchStart);
    const metadata = await getRiskMetadata();

    // Calculate total cost: LLM tokens (from withBilling) + tool call costs
    const toolCostTotal = toolCallResults.reduce((sum, r) => sum + r.cost_usd, 0);
    const totalCost = context.costUsd + toolCostTotal;

    const response = NextResponse.json(
      {
        message: {
          role: "assistant" as const,
          content: finalContent,
        },
        model: finalModel,
        usage: {
          prompt_tokens: totalUsage.prompt_tokens,
          completion_tokens: totalUsage.completion_tokens,
          total_tokens: totalUsage.total_tokens,
        },
        tool_calls_summary: toolCallResults.length > 0
          ? toolCallResults.map((r) => ({
              tool: r.name,
              capability: r.capability_id,
              cost_usd: r.cost_usd,
              latency_ms: r.latency_ms,
              error: r.error ?? null,
            }))
          : null,
        _metadata: buildMetadataBody(metadata),
        _agent: {
          cost_usd: totalCost,
          llm_cost_usd: context.costUsd,
          tool_cost_usd: toolCostTotal,
          tool_calls: toolCallResults.length,
          request_id: context.requestId,
          latency_ms: latency,
        },
      },
      {
        headers: {
          ...getCorsHeaders(origin),
          "X-Data-Fetch-Latency-Ms": String(latency),
        },
      },
    );
    addMetadataHeaders(response, metadata);
    return response;
  },
  {
    capabilityId: "chat-risk-analyst",
    getTokenEstimates: estimateChatTokens,
  },
);

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}
```

---

## Phase 4: Implement SSE streaming (optional, can defer)

The `response_mode` parameter is already in the schema (`markdown | catalog | hybrid`). Streaming support adds real-time UX for longer responses.

### Step 4.1 — Add streaming path

When `response_mode` is `"hybrid"` or `"catalog"`, use `openai.chat.completions.create({ stream: true })`:

- Stream text deltas as SSE `data:` events
- When a tool call is detected, emit a `data: {"type": "tool_call_start", "tool": "get_risk_metrics", "args": {...}}` event
- Execute the tool call, then emit `data: {"type": "tool_call_result", "tool": "...", "cost_usd": 0.001, ...}`
- Continue streaming the LLM's response after tool results

SSE response format:

```
data: {"type": "delta", "content": "NVDA's current "}
data: {"type": "delta", "content": "L3 market hedge ratio is "}
data: {"type": "tool_call_start", "tool": "get_risk_metrics", "args": {"ticker": "NVDA"}}
data: {"type": "tool_call_result", "tool": "get_risk_metrics", "cost_usd": 0.001, "latency_ms": 85}
data: {"type": "delta", "content": "0.76, meaning you'd short $0.76 of SPY per $1 of NVDA..."}
data: {"type": "done", "usage": {...}, "_agent": {...}}
```

**Implementation:** Create a `ReadableStream` with a `TransformStream` that intercepts the OpenAI stream, detects tool calls, executes them, feeds results back, and forwards text deltas to the client.

This is more complex and can be done as a follow-up. The non-streaming JSON path (Phase 3) is the priority.

---

## Phase 5: Update system prompt with portfolio-hedge-analyst knowledge

### Step 5.1 — Enhance the system prompt

The current system prompt is 2 sentences. Replace it with a richer prompt that incorporates knowledge from the BWMACRO `riskmodels-portfolio-hedge-analyst` skill. Key additions:

- Explain ERM3 L3 model structure (market → sector → subsector → residual)
- Define hedge ratio semantics (dollars of ETF per $1 of stock, negative HRs are valid)
- Define explained risk semantics (variance fractions summing to ~1 at L3)
- Describe the "risk is not inherently bad" philosophy (from the skill)
- Instruct the model to recommend L3 hedges as the default when hedging is relevant
- Instruct it to use only ETF-based hedges (no options/derivatives)
- Include the tool cost reporting convention

### Step 5.2 — Extract system prompt to a separate file

Move the system prompt out of the route into `lib/chat/system-prompt.ts` for maintainability:

```typescript
export const CHAT_SYSTEM_PROMPT = `...`;
```

This makes it easy to iterate on the prompt without touching route logic.

---

## Phase 6: Update capability definition + OpenAPI

### Step 6.1 — Update capabilities.ts description

Update the `chat-risk-analyst` capability description to reflect that it now has tool access:

```typescript
{
  id: "chat-risk-analyst",
  name: "AI Risk Analyst",
  description:
    "Natural language risk analysis with live data access. The AI analyst can fetch metrics, " +
    "hedge ratios, L3 decomposition, rankings, macro correlations, and portfolio risk index " +
    "in real time via tool calls. Each tool call is billed at the corresponding endpoint rate " +
    "in addition to per-token LLM costs. Supports streaming via response_mode=hybrid.",
  // ...
}
```

### Step 6.2 — Update OpenAPI spec `/chat` endpoint

Update the `description` field and add documentation for the new response fields:

- Add `tool_calls_summary` to the 200 response schema (array of `{ tool, capability, cost_usd, latency_ms, error }`)
- Update `_agent` schema to include `llm_cost_usd`, `tool_cost_usd`, `tool_calls`
- Note in the description that tool call costs are additional to LLM token costs
- Document the SSE streaming format under `response_mode: hybrid`

### Step 6.3 — Update MCP server capability data

Regenerate `mcp/data/capabilities.json` from the updated `CAPABILITIES` array so the MCP server reflects the enhanced chat capability.

---

## Phase 7: Cost transparency and agent integration

### Step 7.1 — Pre-flight cost estimation for chat

Update `lib/agent/cost-estimator.ts` to provide a note for chat estimates:

```typescript
// For chat-risk-analyst, the estimate covers LLM tokens only.
// Tool calls (metrics, decomposition, etc.) are billed separately
// at their standard rates. Typical chat turn with 1-2 tool calls:
// ~$0.003 LLM + ~$0.002-$0.01 tools = $0.005-$0.013 total.
```

### Step 7.2 — Add `_agent.tool_calls_available` to estimate response

When estimating chat costs, include the list of available tools and their per-call costs:

```json
{
  "estimated_cost_usd": 0.003,
  "note": "LLM token cost only. Tool calls billed separately.",
  "available_tools": [
    { "name": "get_risk_metrics", "capability": "metrics", "cost_usd": 0.001 },
    { "name": "get_l3_decomposition", "capability": "l3-decomposition", "cost_usd": 0.02 },
    ...
  ]
}
```

---

## Billing model for chat with tools

| Component | Billing | Who pays |
|---|---|---|
| LLM tokens (all rounds) | per_token ($0.001/$0.002 per 1K) | Charged via `withBilling()` on the chat capability |
| Tool call: get_risk_metrics | per_request $0.001 | Charged via `deductBalance()` in tool-executor |
| Tool call: get_l3_decomposition | per_request $0.02 (premium) | Charged via `deductBalance()` in tool-executor |
| Tool call: compute_portfolio_risk_index | per_request $0.03 (premium) | Charged via `deductBalance()` in tool-executor |
| Total | LLM + sum(tool costs) | Reported in `_agent.cost_usd` |

**Example cost for a typical chat turn** where the user asks "What's NVDA's risk profile and how does it correlate with bitcoin?":
- LLM tokens (~1500 in, ~800 out): $0.0031
- get_risk_metrics(NVDA): $0.001
- get_factor_correlation(NVDA, bitcoin): $0.002
- **Total: ~$0.006**

This is transparent, predictable, and aligns with the per-request billing model for all other endpoints.

---

## Verification checklist

- [ ] `lib/chat/tools.ts` exports `CHAT_TOOLS` and `TOOL_CAPABILITY_MAP`
- [ ] `lib/chat/tool-executor.ts` executes all 8 tools via DAL, records billing per call
- [ ] `lib/chat/system-prompt.ts` contains enhanced prompt with ERM3 knowledge
- [ ] `app/api/chat/route.ts` implements tool-use loop (max 5 rounds)
- [ ] Chat response includes `tool_calls_summary` array with per-tool costs
- [ ] Chat response `_agent` block includes `llm_cost_usd`, `tool_cost_usd`, `tool_calls` count
- [ ] Each tool call appears as a separate `billing_event` in Supabase
- [ ] `_agent.cost_usd` = LLM cost + sum of tool costs
- [ ] Failed tool calls are not billed (cost_usd = 0 on error)
- [ ] `npx tsc --noEmit` passes
- [ ] Chat correctly resolves company names via search_tickers before fetching data
- [ ] Chat reports cost at the end of its response (system prompt instruction)
- [ ] OpenAPI spec updated with new response schema fields
- [ ] capabilities.ts description updated to mention tool access

---

## Files touched (summary)

| File | Change type | Phase |
|---|---|---|
| `lib/chat/tools.ts` | **New file** — OpenAI tool schemas + capability mapping | 1 |
| `lib/chat/tool-executor.ts` | **New file** — tool dispatch + DAL calls + per-tool billing | 2 |
| `lib/chat/system-prompt.ts` | **New file** — enhanced system prompt | 5 |
| `app/api/chat/route.ts` | **Rewrite** — tool-use loop, accumulated costs, new response shape | 3 |
| `lib/agent/capabilities.ts` | Update `chat-risk-analyst` description | 6 |
| `lib/agent/cost-estimator.ts` | Add tool cost note to chat estimates | 7 |
| `OPENAPI_SPEC.yaml` | Update `/chat` response schema, add tool_calls_summary | 6 |
| `mcp/data/capabilities.json` | Regenerate from updated CAPABILITIES | 6 |

---

## Related docs

- `PREMIUM_TIER_DESIGN.md` — Chat is premium; tool calls that hit premium endpoints (L3, PRI) are billed at premium rates
- `PREMIUM_TIER_IMPLEMENTATION.md` — Phase 1 tier tagging is prerequisite (already done in capabilities.ts)
- BWMACRO `.agents/skills/riskmodels-portfolio-hedge-analyst/SKILL.md` — Source for enhanced system prompt content and portfolio analysis workflow
- `lib/dal/risk-engine-v3.ts`, `lib/dal/macro-factors.ts`, etc. — DAL functions to import in tool-executor
