/**
 * RiskModels API MCP server — transport-agnostic factory.
 *
 * `createMcpServer()` returns a fully-configured `McpServer` with all
 * resources and tools registered. Callers attach a transport (stdio,
 * Streamable HTTP, etc.) separately.
 *
 * Keep this file free of transport imports so the stdio binary and any
 * other transport can import the same factory.
 *
 * Tools come from the shared registry `registerRiskModelsTools`
 * (lib/mcp/tools/riskmodels-tools.ts), the same one the hosted server
 * (`lib/mcp/server.ts`) uses. The hosted server also registers
 * `riskmodels_render_artifact`, which needs GCP auth and is not in this package.
 */

import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
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
} from "../../lib/mcp/tools/riskmodels-tools.js";
import { FIRST_LIVE_PROMPT_MCP, MCP_SERVER_INSTRUCTIONS } from "../../lib/mcp/activation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// tsc nests output under dist/mcp/src because the server imports ../../lib, so
// data/ is one level up from src/ but three levels up from the compiled file.
const DATA_DIR =
  [join(__dirname, "..", "data"), join(__dirname, "..", "..", "..", "data")].find((d) =>
    existsSync(join(d, "capabilities.json")),
  ) ?? join(__dirname, "..", "data");

const DEFAULT_API_BASE = "https://riskmodels.app";
const CLI_CONFIG_PATH = join(homedir(), ".config", "riskmodels", "config.json");

type CliConfig = { apiKey?: string; apiBaseUrl?: string };

export type McpServerOptions = {
  /** Override the API key resolution (env → CLI config → caller-supplied). */
  apiKey?: string;
  /** Override the API base URL (env → CLI config → default). */
  apiBase?: string;
};

function resolveCredentials(opts: McpServerOptions = {}): {
  apiKey: string | null;
  apiBase: string;
} {
  if (opts.apiKey || opts.apiBase) {
    const envBase =
      process.env.RISKMODELS_API_BASE ||
      process.env.NEXT_PUBLIC_APP_URL ||
      undefined;
    return {
      apiKey: opts.apiKey ?? process.env.RISKMODELS_API_KEY ?? null,
      apiBase: (opts.apiBase || envBase || DEFAULT_API_BASE).replace(/\/$/, ""),
    };
  }

  const envKey = process.env.RISKMODELS_API_KEY;
  const envBase =
    process.env.RISKMODELS_API_BASE ||
    process.env.NEXT_PUBLIC_APP_URL ||
    undefined;

  let cfg: CliConfig = {};
  if (existsSync(CLI_CONFIG_PATH)) {
    try {
      cfg = JSON.parse(readFileSync(CLI_CONFIG_PATH, "utf-8")) as CliConfig;
    } catch {
      // ignore — corrupt config just falls through to env
    }
  }

  const apiKey = envKey || cfg.apiKey || null;
  const apiBase = (envBase || cfg.apiBaseUrl || DEFAULT_API_BASE).replace(/\/$/, "");
  return { apiKey, apiBase };
}

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
 * Build a fully-configured RiskModels MCP server.
 *
 * No transport is attached — caller is responsible for
 * `server.connect(transport)` with whichever transport fits their runtime.
 */
export function createMcpServer(opts: McpServerOptions = {}): McpServer {
  const server = new McpServer(
    {
      name: "riskmodels-api",
      version: "2.0.0",
    },
    { instructions: MCP_SERVER_INSTRUCTIONS },
  );
  withAnnotationTitles(server);
  const credentials = resolveCredentials(opts);
  const sdk = createRiskModelsSdk({
    apiKey: credentials.apiKey,
    apiBase: credentials.apiBase,
  });

  // --- Resources ---

  // riskmodels:///manifest — agent manifest (fetch from API if base URL set, else static)
  server.registerResource(
    "manifest",
    "riskmodels:///manifest",
    {
      title: "RiskModels Agent Manifest",
      description: "Agent Protocol service discovery manifest (from API when base URL set)",
      mimeType: "application/json",
    },
    async (uri) => {
      const { apiBase } = resolveCredentials(opts);
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
        _note: "Set RISKMODELS_API_BASE or NEXT_PUBLIC_APP_URL to fetch live manifest.",
      };
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(payload, null, 2) }],
      };
    }
  );

  // riskmodels:///capabilities — list of API capabilities
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

  // riskmodels:///schemas/list — list of schema paths
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

  // riskmodels:///schemas/{path} — individual schema
  const schemaPaths = (): string[] => {
    const list = loadJson<string[]>("schema-paths.json");
    return list || [];
  };

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

  // riskmodels:///openapi — OpenAPI spec if present
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
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ info: { title: "RiskModels API" }, _note: "Add openapi.json or openapi.yaml to mcp/data/" }) }],
      };
    }
  );

  registerRiskModelsWhitepaperResources(server, DATA_DIR);
  registerRiskModelsPrompts(server, FIRST_LIVE_PROMPT_MCP);

  // --- Tools: the shared 2.0 registry (hosted adds riskmodels_render_artifact) ---

  registerRiskModelsTools(sdk, server, { apiKey: credentials.apiKey });

  return server;
}
