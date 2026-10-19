/**
 * Hosted MCP surfaces.
 *
 * Since tool set 2.0 all hosted routes — `/api/mcp/sse` ("default", the
 * Anthropic-directory listing), `/api/mcp/openai` ("openai", ChatGPT /
 * Cursor / Gemini), and the conventional `/api/mcp` alias — register the same
 * tools, resources, prompts and server instructions (see lib/mcp/server.ts).
 * The surface only selects the OAuth protected-resource metadata URL and the
 * log tag in lib/mcp/http-handler.ts.
 */

export type McpSurface = "default" | "openai";

export const ROOT_MCP_PATH = "/api/mcp";
export const OPENAI_MCP_PATH = "/api/mcp/openai";
