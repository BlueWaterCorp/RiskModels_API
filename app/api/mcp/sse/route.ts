/**
 * Hosted MCP endpoint — `GET/POST /api/mcp/sse`.
 *
 * Implements MCP Streamable HTTP via `WebStandardStreamableHTTPServerTransport`
 * (Web-standard Request/Response, works in Next.js App Router without Node
 * adapter glue).
 *
 * Billing note: we DO NOT bill at this layer. Each MCP tool is a thin
 * wrapper that calls the existing REST endpoint (`/api/metrics/*`,
 * `/api/l3-decomposition`, `/api/portfolio/risk-snapshot`) with the user's
 * API key — those endpoints run `withBilling` and charge normally.
 * Discovery tools (`*_list_endpoints`, `*_get_capability`, etc.) hit no
 * billable endpoint so they're free. This layer only authenticates and
 * dispatches; double-charging would happen if we added billing here.
 */

import { NextRequest } from "next/server";
import {
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/lib/mcp/server";
import { authenticateMcpRequest } from "@/lib/mcp/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Pro caps at 60s. Streamable HTTP in stateless mode closes after each
// POST request/response cycle — tool calls are sub-second in the common case.
// GET (the server-push SSE stream) is rejected with 405 below, so it cannot
// hold a connection open past the function timeout.
// Raise this only after confirming the deployment tier supports longer.
export const maxDuration = 60;

function errorResponse(status: number, message: string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: status === 401 ? -32001 : -32000, message },
      id: null,
    }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    },
  );
}

async function handle(req: NextRequest): Promise<Response> {
  const auth = await authenticateMcpRequest(req);
  if (!auth.ok) return errorResponse(auth.status, auth.error);

  // Tools call back into our own REST endpoints. Prefer the explicit API URL
  // envs — `NEXT_PUBLIC_APP_URL` points to the portal (.net), not the API (.app).
  const server = createMcpServer({
    apiKey: auth.apiKey,
    apiBase:
      process.env.RISKMODELS_API_URL ||
      process.env.NEXT_PUBLIC_RISKMODELS_API_URL ||
      "https://riskmodels.app",
  });

  // Stateless mode: each request gets its own transport + server pair. This
  // is simplest for serverless — no cross-invocation session state needed
  // because MCP tool calls in this repo are all one-shot request/response
  // (no server-initiated notifications). If we later need stateful sessions
  // (e.g. resource subscriptions), switch to a `sessionIdGenerator` + Redis
  // event store.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    // Do not call server.close() here (including in `finally`). It runs before
    // Next.js consumes the Response body and closes all SSE streams via
    // transport.close(), yielding empty text/event-stream bodies (clients see
    // Content-Length: 0 / immediate EOF). SDK stateless pattern: return
    // handleRequest() and let the runtime drop the pair after the stream ends.
    return await transport.handleRequest(req);
  } catch (err) {
    console.error(`[mcp-sse] transport error for ${auth.keyPrefix}:`, err);
    try {
      await server.close();
    } catch {
      // best effort
    }
    return errorResponse(500, "MCP transport error");
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}

// GET on a Streamable HTTP endpoint opens the "standalone SSE stream" used
// for server-initiated notifications. We don't push notifications — every
// tool call is a one-shot request/response handled by POST — and on Vercel
// serverless that stream would just idle until the 60s function timeout
// kills it (user-reported "SSE connection opens but drops after ~70s").
// The MCP Streamable HTTP spec explicitly permits returning 405 here; MCP
// clients (including Claude) fall back to POST-only when they see it.
export async function GET(): Promise<Response> {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message:
          "Method Not Allowed: this endpoint does not provide a server-initiated SSE stream. Use POST for JSON-RPC requests.",
      },
      id: null,
    }),
    {
      status: 405,
      headers: {
        "Content-Type": "application/json",
        Allow: "POST, OPTIONS",
      },
    },
  );
}

export async function DELETE(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Authorization, Content-Type, Mcp-Session-Id, Last-Event-Id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    },
  });
}
