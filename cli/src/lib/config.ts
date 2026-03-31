import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export type AuthMode = "billed" | "direct";

export interface RiskmodelsConfig {
  mode: AuthMode;
  apiKey?: string;
  /** Base URL without trailing slash, e.g. https://riskmodels.app */
  apiBaseUrl?: string;
  /** OAuth client credentials (billed mode); scope defaults match the Python SDK. */
  clientId?: string;
  clientSecret?: string;
  oauthScope?: string;
  supabaseUrl?: string;
  serviceRoleKey?: string;
}

export const DEFAULT_API_BASE = "https://riskmodels.app";

export function configPath(): string {
  return path.join(homedir(), ".config", "riskmodels", "config.json");
}

export async function loadConfig(): Promise<RiskmodelsConfig | null> {
  const p = configPath();
  try {
    const raw = await readFile(p, "utf8");
    return JSON.parse(raw) as RiskmodelsConfig;
  } catch {
    return null;
  }
}

export async function saveConfig(cfg: RiskmodelsConfig): Promise<void> {
  const p = configPath();
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

export function maskSecret(value: string | undefined, visible = 6): string {
  if (!value) return "(not set)";
  if (value.length <= visible) return "***";
  return `${value.slice(0, visible)}...`;
}

export function isBilledReady(cfg: RiskmodelsConfig | null): boolean {
  return (
    !!cfg &&
    cfg.mode === "billed" &&
    (!!cfg.apiKey?.trim() || (!!cfg.clientId?.trim() && !!cfg.clientSecret?.trim()))
  );
}

export function isDirectReady(cfg: RiskmodelsConfig | null): boolean {
  return (
    !!cfg &&
    cfg.mode === "direct" &&
    !!cfg.supabaseUrl?.trim() &&
    !!cfg.serviceRoleKey?.trim()
  );
}

export function needsConfigMessage(): string {
  return "Supabase credentials not configured. Run: riskmodels config init";
}

export function needsApiKeyMessage(): string {
  return "API key not configured. Run: riskmodels config init (billed mode) or: riskmodels config set apiKey <rm_agent_...>";
}
