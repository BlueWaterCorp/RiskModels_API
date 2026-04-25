import type { ClientDetection } from "./mcp-config-paths.js";
import { redactJson } from "./redact.js";

export interface InstallPlan {
  client: string;
  label: string;
  status: string;
  mode: string;
  configPath?: string;
  notes: string[];
  mcpServer: unknown;
}

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

export function buildInstallPlans(
  detections: ClientDetection[],
  opts: { apiKey?: string; embedKey?: boolean },
): InstallPlan[] {
  return detections.map((detection) => ({
    client: detection.client,
    label: detection.label,
    status: detection.status,
    mode: detection.mode,
    configPath: detection.configPath,
    notes: detection.notes,
    mcpServer: redactJson(defaultMcpServerConfig(opts.apiKey, opts.embedKey)),
  }));
}

export function firstPrompt(): string {
  return "Compare AAPL and NVDA using RiskModels. What am I really betting on?";
}
