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
// request/response cycle — tool calls are sub-second in the common case.
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
    const response = await transport.handleRequest(req);
    return response;
  } catch (err) {
    console.error(`[mcp-sse] transport error for ${auth.keyPrefix}:`, err);
    return errorResponse(500, "MCP transport error");
  } finally {
    // Release server resources; transport is per-request so it's disposed
    // when the response stream closes.
    try {
      await server.close();
    } catch {
      // best effort
    }
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
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
