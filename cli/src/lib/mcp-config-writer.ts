import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { configPath, DEFAULT_API_BASE, loadConfig, type RiskmodelsConfig } from "./config.js";
import type { ClientDetection } from "./mcp-config-paths.js";
import { defaultMcpServerConfig } from "./mcp-install-plan.js";

export interface ConfigWriteResult {
  client: string;
  label: string;
  configPath?: string;
  action: "written" | "skipped" | "error";
  backupPath?: string;
  message: string;
}

export interface SafeWriteOptions {
  apiKey?: string;
  embedKey?: boolean;
  apiBaseUrl?: string;
  now?: Date;
}

export interface SharedConfigWriteResult {
  configPath: string;
  backupPath?: string;
  message: string;
}

const RISKMODELS_SERVER_NAME = "riskmodels";
const TOML_MANAGED_HEADER = "# RiskModels MCP (managed by riskmodels CLI)";

function timestamp(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function readIfExists(filePath: string): Promise<{ exists: boolean; text: string }> {
  try {
    return { exists: true, text: await readFile(filePath, "utf8") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { exists: false, text: "" };
    }
    throw error;
  }
}

async function backupIfExists(filePath: string, exists: boolean, now?: Date): Promise<string | undefined> {
  if (!exists) return undefined;
  const backupPath = `${filePath}.riskmodels-backup-${timestamp(now)}`;
  await copyFile(filePath, backupPath);
  return backupPath;
}

function assertPlainObject(value: unknown, filePath: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${filePath} must contain a JSON object`);
  }
}

export function mergeJsonMcpConfig(existingText: string, mcpServer: unknown): string {
  const parsed = existingText.trim() ? JSON.parse(existingText) : {};
  assertPlainObject(parsed, "MCP config");
  const currentServers = parsed.mcpServers;
  if (currentServers !== undefined) {
    assertPlainObject(currentServers, "mcpServers");
  }
  const merged = {
    ...parsed,
    mcpServers: {
      ...(currentServers as Record<string, unknown> | undefined),
      [RISKMODELS_SERVER_NAME]: mcpServer,
    },
  };
  const text = JSON.stringify(merged, null, 2) + "\n";
  JSON.parse(text);
  return text;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

function removeRiskmodelsTomlBlock(existingText: string): string {
  const lines = existingText.split(/\r?\n/);
  const out: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const startsRiskmodelsBlock =
      trimmed === "[mcp_servers.riskmodels]" ||
      trimmed === "[mcp_servers.riskmodels.env]" ||
      trimmed === "[mcpServers.riskmodels]" ||
      trimmed === "[mcpServers.riskmodels.env]";
    const startsAnySection = /^\[[^\]]+\]$/.test(trimmed);

    if (startsRiskmodelsBlock) {
      skipping = true;
      if (out[out.length - 1]?.trim() === TOML_MANAGED_HEADER) {
        out.pop();
      }
      continue;
    }

    if (skipping && startsAnySection && !startsRiskmodelsBlock) {
      skipping = false;
    }

    if (!skipping && trimmed !== TOML_MANAGED_HEADER) {
      out.push(line);
    }
  }

  return out.join("\n").trimEnd();
}

export function mergeCodexTomlConfig(existingText: string, mcpServer: unknown): string {
  const server = mcpServer as { command?: unknown; args?: unknown; env?: unknown };
  if (typeof server.command !== "string" || !Array.isArray(server.args)) {
    throw new Error("Codex MCP server config requires command and args");
  }

  const base = removeRiskmodelsTomlBlock(existingText);
  const lines = [
    TOML_MANAGED_HEADER,
    "[mcp_servers.riskmodels]",
    `command = ${tomlString(server.command)}`,
    `args = ${tomlArray(server.args.map(String))}`,
  ];

  if (server.env && typeof server.env === "object" && !Array.isArray(server.env)) {
    lines.push("", "[mcp_servers.riskmodels.env]");
    for (const [key, value] of Object.entries(server.env)) {
      if (typeof value === "string") {
        lines.push(`${key} = ${tomlString(value)}`);
      }
    }
  }

  const text = `${base ? `${base}\n\n` : ""}${lines.join("\n")}\n`;
  validateRiskmodelsToml(text);
  return text;
}

export function validateRiskmodelsToml(text: string): void {
  const lines = text.split(/\r?\n/);
  let inRiskmodelsBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (/^\[[^\]]+\]$/.test(trimmed)) {
      inRiskmodelsBlock =
        trimmed === "[mcp_servers.riskmodels]" ||
        trimmed === "[mcp_servers.riskmodels.env]";
      continue;
    }
    if (!inRiskmodelsBlock) continue;
    if (/^[A-Za-z0-9_]+ = (".*"|\[[^\]]*\])$/.test(trimmed)) continue;
    throw new Error(`Unsupported TOML line: ${line}`);
  }
}

export async function writeSharedApiKey(
  apiKey: string,
  apiBaseUrl = DEFAULT_API_BASE,
  now?: Date,
): Promise<SharedConfigWriteResult> {
  const existing = await loadConfig();
  const cfg: RiskmodelsConfig = {
    ...(existing ?? { mode: "billed" as const }),
    mode: "billed",
    apiKey,
    apiBaseUrl: (existing?.apiBaseUrl ?? apiBaseUrl).replace(/\/$/, ""),
  };
  const p = configPath();
  const current = await readIfExists(p);
  const backupPath = await backupIfExists(p, current.exists, now);
  await mkdir(path.dirname(p), { recursive: true });
  const text = JSON.stringify(cfg, null, 2) + "\n";
  JSON.parse(text);
  await writeFile(p, text, "utf8");
  return {
    configPath: p,
    backupPath,
    message: current.exists ? "Stored API key in shared config and created backup." : "Stored API key in shared config.",
  };
}

async function writeTextWithBackup(filePath: string, text: string, now?: Date): Promise<string | undefined> {
  const existing = await readIfExists(filePath);
  const backupPath = await backupIfExists(filePath, existing.exists, now);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text, "utf8");
  return backupPath;
}

export async function installMcpConfig(
  detection: ClientDetection,
  opts: SafeWriteOptions = {},
): Promise<ConfigWriteResult> {
  if (!detection.configPath || detection.client === "vscode") {
    return {
      client: detection.client,
      label: detection.label,
      configPath: detection.configPath,
      action: "skipped",
      message: "No verified auto-write config target for this client.",
    };
  }

  try {
    const { exists, text } = await readIfExists(detection.configPath);
    const mcpServer = defaultMcpServerConfig(opts.apiKey, !!opts.embedKey);
    const nextText =
      detection.client === "codex"
        ? mergeCodexTomlConfig(text, mcpServer)
        : mergeJsonMcpConfig(text, mcpServer);
    const backupPath = await writeTextWithBackup(detection.configPath, nextText, opts.now);
    return {
      client: detection.client,
      label: detection.label,
      configPath: detection.configPath,
      action: "written",
      backupPath,
      message: exists ? "Merged riskmodels MCP server and created backup." : "Created config with riskmodels MCP server.",
    };
  } catch (error) {
    return {
      client: detection.client,
      label: detection.label,
      configPath: detection.configPath,
      action: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function removeJsonMcpConfig(existingText: string): { text: string; removed: boolean } {
  const parsed = existingText.trim() ? JSON.parse(existingText) : {};
  assertPlainObject(parsed, "MCP config");
  const servers = parsed.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    return { text: JSON.stringify(parsed, null, 2) + "\n", removed: false };
  }
  const nextServers = { ...(servers as Record<string, unknown>) };
  const removed = Object.prototype.hasOwnProperty.call(nextServers, RISKMODELS_SERVER_NAME);
  delete nextServers[RISKMODELS_SERVER_NAME];
  const next = { ...parsed, mcpServers: nextServers };
  return { text: JSON.stringify(next, null, 2) + "\n", removed };
}

export function removeCodexTomlConfig(existingText: string): { text: string; removed: boolean } {
  const nextText = removeRiskmodelsTomlBlock(existingText);
  validateRiskmodelsToml(nextText);
  return {
    text: `${nextText}${nextText ? "\n" : ""}`,
    removed: nextText.trimEnd() !== existingText.trimEnd(),
  };
}

export async function uninstallMcpConfig(
  detection: ClientDetection,
  opts: { now?: Date } = {},
): Promise<ConfigWriteResult> {
  if (!detection.configPath || detection.client === "vscode") {
    return {
      client: detection.client,
      label: detection.label,
      configPath: detection.configPath,
      action: "skipped",
      message: "No verified auto-write config target for this client.",
    };
  }

  try {
    const { exists, text } = await readIfExists(detection.configPath);
    if (!exists) {
      return {
        client: detection.client,
        label: detection.label,
        configPath: detection.configPath,
        action: "skipped",
        message: "Config file does not exist.",
      };
    }
    const removal =
      detection.client === "codex"
        ? removeCodexTomlConfig(text)
        : removeJsonMcpConfig(text);
    if (!removal.removed) {
      return {
        client: detection.client,
        label: detection.label,
        configPath: detection.configPath,
        action: "skipped",
        message: "No riskmodels MCP server block found.",
      };
    }
    const backupPath = await writeTextWithBackup(detection.configPath, removal.text, opts.now);
    return {
      client: detection.client,
      label: detection.label,
      configPath: detection.configPath,
      action: "written",
      backupPath,
      message: "Removed only the riskmodels MCP server block and created backup.",
    };
  } catch (error) {
    return {
      client: detection.client,
      label: detection.label,
      configPath: detection.configPath,
      action: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
