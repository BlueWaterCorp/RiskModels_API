import chalk from "chalk";
import type { ClientDetection } from "./mcp-config-paths.js";
import { abbreviatePath } from "./path-display.js";
import { getCliPackageVersion } from "./cli-version.js";

const BULLET = "•";

function logLine(line = ""): void {
  console.log(line);
}

export type DoctorPayload = {
  ok: boolean;
  checks: { id: string; ok: boolean; detail: string }[];
  clients: ClientDetection[];
  note: string;
};

export function printDoctorHuman(payload: DoctorPayload): void {
  logLine("");
  logLine(`${chalk.bold("riskmodels doctor")} ${chalk.dim(`(CLI ${getCliPackageVersion()})`)}`);
  logLine("");
  logLine(payload.ok ? chalk.green.bold("All checks passed") : chalk.yellow.bold("Some checks need attention"));
  logLine("");
  logLine(chalk.bold("Checks:"));
  for (const c of payload.checks) {
    const icon = c.ok ? chalk.green("✓") : chalk.red("✗");
    logLine(`  ${icon} ${chalk.bold(c.id)}${c.detail ? chalk.dim(` — ${c.detail}`) : ""}`);
  }
  logLine("");
  logLine(chalk.bold("MCP client detection:"));
  for (const d of payload.clients) {
    const p = d.configPath ? chalk.dim(` — ${abbreviatePath(d.configPath)}`) : "";
    logLine(`  ${BULLET} ${d.label} (${d.status}${d.mode !== "guidance" ? `, ${d.mode}` : ""})${p}`);
  }
  logLine("");
  logLine(chalk.dim(payload.note));
  logLine("");
}

export type StatusPayload = {
  configPath: string;
  configFound: boolean;
  apiBaseUrl: string;
  apiKey: string;
  oauthConfigured: boolean;
  mcpClients: ClientDetection[];
};

export function printStatusHuman(payload: StatusPayload): void {
  logLine("");
  logLine(`${chalk.bold("riskmodels status")} ${chalk.dim(`(CLI ${getCliPackageVersion()})`)}`);
  logLine("");
  const cfgDisp = abbreviatePath(payload.configPath);
  logLine(`${chalk.bold("Shared config:")} ${cfgDisp}`);
  if (cfgDisp !== payload.configPath) {
    logLine(chalk.dim(`  (full path: ${payload.configPath})`));
  }
  logLine(
    `  ${BULLET} ${payload.configFound ? chalk.green("file present") : chalk.dim("file missing (run install or config init)")}`,
  );
  logLine(`  ${BULLET} ${chalk.bold("apiBaseUrl")} ${chalk.dim(payload.apiBaseUrl)}`);
  logLine(`  ${BULLET} ${chalk.bold("API key")} ${payload.apiKey}`);
  logLine(`  ${BULLET} ${chalk.bold("OAuth")} ${payload.oauthConfigured ? chalk.green("configured") : chalk.dim("not configured")}`);
  logLine("");
  logLine(chalk.bold("MCP-related clients:"));
  for (const d of payload.mcpClients) {
    const p = d.configPath ? chalk.dim(` — ${abbreviatePath(d.configPath)}`) : "";
    logLine(`  ${BULLET} ${d.label}: ${d.status}${p}`);
  }
  logLine("");
}
