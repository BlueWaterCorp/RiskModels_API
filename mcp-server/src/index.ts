/**
 * RiskModels API visibility MCP server.
 * Exposes resources (manifest, capabilities, schemas) and tools for API discovery.
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

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

const server = new McpServer({
  name: "riskmodels-api",
  version: "1.0.0",
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
    const baseUrl = process.env.RISKMODELS_API_BASE || process.env.NEXT_PUBLIC_APP_URL;
    if (baseUrl) {
      try {
        const res = await fetch(`${baseUrl.replace(/\/$/, "")}/.well-known/agent-manifest.json`);
        if (res.ok) {
          const json = await res.json();
          return {
            contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(json, null, 2) }],
          };
        }
      } catch {
        // fall through to static
      }
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
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ info: { title: "RiskModels API" }, _note: "Add openapi.json or openapi.yaml to mcp-server/data/" }) }],
    };
  }
);

// --- Tools ---

server.registerTool(
  "riskmodels_list_endpoints",
  {
    title: "List RiskModels API Endpoints",
    description: "List all public API capabilities (id, name, method, endpoint, short description)",
    inputSchema: z.object({}).optional(),
  },
  async () => {
    const capabilities = loadJson<Array<{ id: string; name: string; method: string; endpoint: string; description: string }>>("capabilities.json");
    if (!capabilities) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "capabilities.json not found" }) }] };
    }
    const list = capabilities.map((c) => ({
      id: c.id,
      name: c.name,
      method: c.method,
      endpoint: c.endpoint,
      description: (c.description || "").slice(0, 80),
    }));
    return { content: [{ type: "text", text: JSON.stringify(list, null, 2) }] };
  }
);

server.registerTool(
  "riskmodels_get_capability",
  {
    title: "Get RiskModels Capability Details",
    description: "Get full capability details (parameters, pricing, examples) by id",
    inputSchema: z.object({
      id: z.string().describe("Capability id (e.g. ticker-returns, risk-decomposition)"),
    }),
  },
  async ({ id }) => {
    const capabilities = loadJson<Array<{ id: string; [k: string]: unknown }>>("capabilities.json");
    if (!capabilities) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Capabilities not loaded" }) }] };
    }
    const cap = capabilities.find((c) => c.id === id);
    if (!cap) {
      return { content: [{ type: "text", text: JSON.stringify({ error: `Unknown capability: ${id}`, available: capabilities.map((c) => c.id) }) }] };
    }
    return { content: [{ type: "text", text: JSON.stringify(cap, null, 2) }] };
  }
);

server.registerTool(
  "riskmodels_get_schema",
  {
    title: "Get RiskModels Response Schema",
    description: "Get JSON schema for an API response by path (e.g. ticker-returns-v2.json)",
    inputSchema: z.object({
      path: z.string().describe("Schema path or filename (e.g. ticker-returns-v2.json or /schemas/ticker-returns-v2.json)"),
    }),
  },
  async ({ path: pathArg }) => {
    const pathSeg = pathArg.replace(/^\/schemas\//, "");
    const filename = pathSeg.endsWith(".json") ? pathSeg : `${pathSeg}.json`;
    const data = loadJson<unknown>(join("schemas", filename));
    if (!data) {
      const paths = loadJson<string[]>("schema-paths.json") || [];
      return { content: [{ type: "text", text: JSON.stringify({ error: `Schema not found: ${filename}`, available: paths }) }] };
    }
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// --- Start stdio transport ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
