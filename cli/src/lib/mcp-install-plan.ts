import type { ClientDetection } from "./mcp-config-paths.js";
import { redactJson, redactSecret } from "./redact.js";

export interface InstallPlan {
  client: string;
  label: string;
  status: string;
  mode: string;
  configPath?: string;
  notes: string[];
  mcpServer: unknown;
}

/** Hosted MCP endpoint (Streamable HTTP). Key-first auth, no npm publish needed. */
export const REMOTE_MCP_URL = "https://riskmodels.app/api/mcp/sse";

export type McpTransport = "remote" | "local";

/**
 * Local stdio path: runs the published `@riskmodels/mcp` server via npx. The key
 * is read from the shared config by default; `--embed-key` writes it into env.
 */
export function defaultMcpServerConfig(apiKey?: string, embedKey = false): unknown {
  return {
    command: "npx",
    args: ["-y", "@riskmodels/mcp"],
    ...(embedKey && apiKey
      ? {
          env: {
            RISKMODELS_API_KEY: apiKey,
          },
        }
      : {}),
  };
}

/**
 * Remote path (default): bridges a stdio client to the hosted endpoint via
 * `mcp-remote`. The key rides in an `Authorization: Bearer` header — kept out of
 * the URL so it never lands in server access logs or referrers. Works today with
 * no npm publish dependency.
 */
export function remoteMcpServerConfig(apiKey?: string): unknown {
  const args = ["-y", "mcp-remote", REMOTE_MCP_URL];
  if (apiKey) {
    args.push("--header", `Authorization: Bearer ${apiKey}`);
  }
  return { command: "npx", args };
}

/**
 * Native `claude mcp add` args for Claude Code — registers the hosted endpoint
 * over HTTP transport at user scope (no mcp-remote shim needed; Claude Code
 * speaks Streamable HTTP directly).
 */
export function claudeCodeRemoteAddArgs(apiKey?: string): string[] {
  const args = ["mcp", "add", "--scope", "user", "--transport", "http", "riskmodels", REMOTE_MCP_URL];
  if (apiKey) {
    args.push("--header", `Authorization: Bearer ${apiKey}`);
  }
  return args;
}

export function mcpServerConfigFor(
  transport: McpTransport,
  apiKey?: string,
  embedKey = false,
): unknown {
  return transport === "remote"
    ? remoteMcpServerConfig(apiKey)
    : defaultMcpServerConfig(apiKey, embedKey);
}

/** RiskModels keys are `rm_agent_live_…` / `rm_…`. Cheap client-side sanity check. */
export function looksLikeRiskmodelsKey(key: string): boolean {
  return /^rm_[A-Za-z0-9_]+$/.test(key.trim());
}

/**
 * Mask `Authorization: Bearer <token>` strings anywhere in a config tree.
 * `redactJson` only masks values whose *key name* matches (e.g. `env.RISKMODELS_API_KEY`);
 * the remote header lives inside an `args` string, so it needs this pass too.
 */
export function redactBearerStrings(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactBearerStrings);
  if (typeof value === "string") {
    const m = value.match(/^(Authorization:\s*Bearer\s+)(.+)$/i);
    return m ? `${m[1]}${redactSecret(m[2])}` : value;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactBearerStrings(v);
    return out;
  }
  return value;
}

export function buildInstallPlans(
  detections: ClientDetection[],
  opts: { apiKey?: string; embedKey?: boolean; transport: McpTransport },
): InstallPlan[] {
  return detections.map((detection) => {
    const claudeCodeNative =
      opts.transport === "remote" && detection.client === "claude" && detection.commandAvailable;
    const mcpServer = redactBearerStrings(
      redactJson(mcpServerConfigFor(opts.transport, opts.apiKey, opts.embedKey)),
    );
    return {
      client: detection.client,
      label: detection.label,
      status: detection.status,
      mode: claudeCodeNative ? "command" : detection.mode,
      configPath: detection.configPath,
      notes: claudeCodeNative
        ? [...detection.notes, "Remote: will register via `claude mcp add --transport http` (user scope)."]
        : detection.notes,
      mcpServer,
    };
  });
}

export function firstPrompt(): string {
  return "Compare AAPL and NVDA using RiskModels. What am I really betting on?";
}
