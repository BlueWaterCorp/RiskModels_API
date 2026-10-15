/**
 * RiskModels MCP server factory — hosted-transport variant.
 *
 * Serves both hosted surfaces (`/api/mcp/sse` and `/api/mcp/openai`) with the
 * same tools, resources, prompts and instructions. Tools come from the shared
 * registry `registerRiskModelsTools` (lib/mcp/tools/riskmodels-tools.ts), the
 * same one the npm stdio server (`mcp/src/server.ts`) uses, plus the
 * hosted-only `riskmodels_render_artifact` from `registerRiskModelsRenderTool`
 * (needs GCP Cloud Run auth, so it is not in the stdio package).
 *
 * This copy accepts `apiKey` / `apiBase` directly because the hosted Next.js
 * route has already authenticated the request. No env/CLI-config resolution.
 * Resource code is mirrored in `mcp/src/server.ts`; keep the two in step.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createRiskModelsSdk,
  withAnnotationTitles,
  registerRiskModelsPrompts,
  registerRiskModelsTools,
  registerRiskModelsWhitepaperResources,
} from "@/lib/mcp/tools/riskmodels-tools";
import { registerRiskModelsRenderTool } from "@/lib/mcp/render-tool";
import { FIRST_LIVE_PROMPT_MCP, MCP_SERVER_INSTRUCTIONS } from "@/lib/mcp/activation";
import type { McpSurface } from "@/lib/mcp/openai-surface";

const DATA_DIR = join(process.cwd(), "mcp", "data");

export type McpServerOptions = {
  /** User's RiskModels API key (already validated upstream by the route). */
  apiKey: string;
  /** API base URL (defaults to `https://riskmodels.app`). */
  apiBase?: string;
  /**
   * Hosted surface ("default" = `/api/mcp/sse`, "openai" = `/api/mcp/openai`).
   * Both register the same tools since tool set 2.0; kept for callers and logs.
   */
  surface?: McpSurface;
};

function loadJson<T>(relativePath: string): T | null {
  const p = join(DATA_DIR, relativePath);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as T;
  } catch {
    return null;
  }
}

function loadText(relativePath: string): string | null {
  const p = join(DATA_DIR, relativePath);
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Build an MCP server ready to be connected to any transport.
 * Caller supplies authenticated user credentials via `opts`.
 */
export function createMcpServer(opts: McpServerOptions): McpServer {
  const server = new McpServer(
    {
      name: "riskmodels-api",
      version: "2.0.0",
    },
    { instructions: MCP_SERVER_INSTRUCTIONS },
  );
  const sdk = createRiskModelsSdk({
    apiKey: opts.apiKey,
    apiBase: opts.apiBase || "https://riskmodels.app",
  });
  withAnnotationTitles(server);

  // --- Resources ---

  server.registerResource(
    "manifest",
    "riskmodels:///manifest",
    {
      title: "RiskModels Agent Manifest",
      description: "Agent Protocol service discovery manifest",
      mimeType: "application/json",
    },
    async (uri) => {
      const apiBase = (opts.apiBase || "https://riskmodels.app").replace(/\/$/, "");
      try {
        const res = await fetch(`${apiBase}/.well-known/agent-manifest.json`);
        if (res.ok) {
          const json = await res.json();
          return {
            contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(json, null, 2) }],
          };
        }
      } catch {
        // fall through to static
      }
      const capabilities = loadJson<unknown[]>("capabilities.json");
      const payload = {
        service: { name: "RiskModels", version: "2.0.0-agent" },
        capabilities: capabilities || [],
      };
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(payload, null, 2) }],
      };
    }
  );

  server.registerResource(
    "capabilities",
    "riskmodels:///capabilities",
    {
      title: "RiskModels API Capabilities",
      description: "List of API capabilities with endpoints, parameters, pricing",
      mimeType: "application/json",
    },
    async (uri) => {
      const data = loadJson<unknown>("capabilities.json");
      const text = data ? JSON.stringify(data, null, 2) : JSON.stringify({ error: "capabilities.json not found" });
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text }],
      };
    }
  );

  server.registerResource(
    "schemas-list",
    "riskmodels:///schemas/list",
    {
      title: "RiskModels Schema Paths",
      description: "List of available response schema paths",
      mimeType: "application/json",
    },
    async (uri) => {
      const data = loadJson<string[]>("schema-paths.json");
      const text = data ? JSON.stringify(data, null, 2) : JSON.stringify([]);
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text }],
      };
    }
  );

  const schemaPaths = (): string[] => loadJson<string[]>("schema-paths.json") || [];

  server.registerResource(
    "schema-by-path",
    new ResourceTemplate("riskmodels:///schemas/{path}", {
      list: async () => ({
        resources: schemaPaths().map((p) => ({
          uri: `riskmodels:///schemas/${encodeURIComponent(p.replace(/^\/schemas\//, ""))}`,
          name: p.split("/").pop() || p,
        })),
      }),
    }),
    {
      title: "RiskModels Response Schema",
      description: "JSON schema for an API response by path (e.g. ticker-returns-v2.json)",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const pathVar = variables.path;
      const pathSeg = typeof pathVar === "string" ? pathVar : Array.isArray(pathVar) ? pathVar[0] : "";
      const normalized = pathSeg.startsWith("/schemas/") ? pathSeg : `/schemas/${pathSeg}`;
      const filename = normalized.split("/").pop() || pathSeg;
      const data = loadJson<unknown>(join("schemas", filename));
      const text = data ? JSON.stringify(data, null, 2) : JSON.stringify({ error: `Schema not found: ${pathSeg}` });
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text }],
      };
    }
  );

  server.registerResource(
    "openapi",
    "riskmodels:///openapi",
    {
      title: "RiskModels OpenAPI Spec",
      description: "OpenAPI 3.x specification for the API",
      mimeType: "application/json",
    },
    async (uri) => {
      const yaml = loadText("openapi.yaml");
      const json = loadJson<unknown>("openapi.json");
      if (json) {
        return {
          contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(json, null, 2) }],
        };
      }
      if (yaml) {
        return {
          contents: [{ uri: uri.href, mimeType: "application/yaml", text: yaml }],
        };
      }
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ info: { title: "RiskModels API" } }) }],
      };
    }
  );

  registerRiskModelsWhitepaperResources(server, DATA_DIR);
  registerRiskModelsPrompts(server, FIRST_LIVE_PROMPT_MCP);

  // --- Tools: the shared 2.0 registry, then the hosted-only render tool ---

  registerRiskModelsTools(sdk, server, { apiKey: opts.apiKey });
  registerRiskModelsRenderTool(server);

  return server;
}
