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

function errorResponse(
  status: number,
  message: string,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: status === 401 ? -32001 : -32000, message },
      id: null,
    }),
    {
      status,
      headers: { "Content-Type": "application/json", ...(extraHeaders ?? {}) },
    },
  );
}

// RFC 9728 challenge so MCP clients (Claude Desktop / Cursor) discover the
// authorization server on a 401 and can run the OAuth connect flow instead of
// failing at client registration. Tier-1 Bearer API keys still authenticate
// and never reach this branch.
//
// GATED OFF BY DEFAULT (`MCP_ADVERTISE_OAUTH`). RiskModels is API-key-first:
// the key is how Lisa's team already connects, how the Anthropic directory
// connector authenticates, and the lowest-friction path for a cold user. The
// authorization server this header points to (`lib/oauth/server.ts` +
// `/.well-known/oauth-protected-resource`) is incomplete, so advertising it
// made keyless discovery probes (Smithery's wizard, Claude's connector wizard)
// follow the challenge into an OAuth flow that hangs. With the flag off, a
// keyless request gets a plain 401 whose message tells the client to supply a
// key — clients fall back to API-key config instead of the hang. Set
// `MCP_ADVERTISE_OAUTH=true` to restore the challenge once OAuth is finished.
//
// Origin is derived from the REQUEST host (the .app origin the client used),
// not NEXT_PUBLIC_APP_URL — that env points at the .net portal here, which has
// no OAuth routes; advertising it sends clients to register against .net.
function wwwAuthenticateHeader(req: NextRequest): Record<string, string> {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const base = host
    ? `${proto}://${host}`
    : (process.env.RISKMODELS_API_URL || "https://riskmodels.app").replace(/\/$/, "");
  return {
    "WWW-Authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
  };
}

async function handle(req: NextRequest): Promise<Response> {
  const auth = await authenticateMcpRequest(req);
  if (!auth.ok) {
    // Only advertise the OAuth challenge when explicitly enabled — see
    // wwwAuthenticateHeader above. Default (flag unset) = key-first, no
    // advertisement, so keyless wizards get a clean 401 instead of hanging.
    const advertiseOAuth = process.env.MCP_ADVERTISE_OAUTH === "true";
    return errorResponse(
      auth.status,
      auth.error,
      auth.status === 401 && advertiseOAuth ? wwwAuthenticateHeader(req) : undefined,
    );
  }

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

// Optional standalone GET SSE stream (server-initiated notifications).
// Spec allows 405 when unsupported; we used to return 405 + a JSON-RPC error
// body. Anthropic's Connectors / Desktop probes open GET first and surface that
// body as a fatal toast even when POST initialize works (known client bugs:
// anthropics/claude-code#78193, #67194). Return a brief valid SSE response and
// close immediately so probes pass without holding a Vercel function open.
export async function GET(): Promise<Response> {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          ": riskmodels MCP — Streamable HTTP; JSON-RPC over POST only\n\n",
        ),
      );
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "close",
      Allow: "GET, POST, DELETE, OPTIONS",
    },
  });
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
