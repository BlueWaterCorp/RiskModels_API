import chalk from "chalk";
import type { SharedConfigWriteResult, ConfigWriteResult } from "./mcp-config-writer.js";
import type { InstallPlan } from "./mcp-install-plan.js";
import type { ClientDetection } from "./mcp-config-paths.js";
import { configPath } from "./config.js";

const BULLET = "•";

/** Shown wherever we direct users to obtain an API key (matches key-issued email sender). */
export const API_KEY_EMAIL_HINT =
  "If you requested a key already, check your inbox for mail from RiskModels (service@riskmodels.app).";

function logLine(line = ""): void {
  console.log(line);
}

function formatBackupBullets(paths: string[]): string[] {
  return paths.filter(Boolean).sort().map((p) => `${BULLET} ${p}`);
}

export function printInstallSuccessHuman(opts: {
  isFirstInstall: boolean;
  writes: ConfigWriteResult[];
  sharedConfigWrite: SharedConfigWriteResult;
  connectionTest: { ok: boolean; endpoint: string; message: string };
  firstPrompt: string;
  hadErrors: boolean;
}): void {
  const { isFirstInstall, writes, sharedConfigWrite, connectionTest, firstPrompt, hadErrors } =
    opts;

  if (isFirstInstall) {
    logLine("");
    logLine(chalk.bold("👋 Welcome to RiskModels MCP!"));
    logLine("");
    logLine("This one-time setup connects your AI coding tools (Claude, Cursor, etc.)");
    logLine("to real-time portfolio risk snapshots, hedge ratios, and factor models.");
    logLine("");
  }

  logLine("");
  if (hadErrors) {
    logLine(chalk.yellow.bold("⚠ RiskModels MCP install finished with errors"));
  } else {
    logLine(chalk.green.bold("✅ RiskModels MCP install completed"));
  }

  logLine("");
  logLine(chalk.bold("Installed / updated in:"));
  const installed = writes.filter((w) => w.action === "written");
  if (installed.length === 0) {
    logLine(`  ${chalk.dim("(no client MCP configs were modified — check detection / permissions)")}`);
  } else {
    for (const w of installed) {
      logLine(`  ${BULLET} ${w.label}`);
    }
  }

  const skipped = writes.filter((w) => w.action === "skipped" && w.client !== "vscode");
  if (skipped.length > 0) {
    logLine("");
    logLine(chalk.dim("Skipped (no change):"));
    for (const w of skipped) {
      logLine(`  ${BULLET} ${w.label} — ${chalk.dim(w.message)}`);
    }
  }

  const vsSkipped = writes.find((w) => w.action === "skipped" && w.client === "vscode");
  if (vsSkipped) {
    logLine("");
    logLine(chalk.dim(`VS Code: ${vsSkipped.message}`));
  }

  const backupPaths: string[] = [];
  if (sharedConfigWrite.backupPath) backupPaths.push(sharedConfigWrite.backupPath);
  for (const w of writes) {
    if (w.backupPath) backupPaths.push(w.backupPath);
  }

  logLine("");
  logLine(chalk.bold("Backups created for safety:"));
  if (backupPaths.length === 0) {
    logLine(`  ${chalk.dim("(none — configs were newly created)")}`);
  } else {
    for (const line of formatBackupBullets(backupPaths)) logLine(`  ${line}`);
  }

  logLine("");
  if (connectionTest.ok) {
    logLine(
      `${chalk.bold("Connection test:")} OK (${chalk.cyan(connectionTest.endpoint)})`,
    );
  } else {
    logLine(`${chalk.bold("Connection test:")} ${chalk.red("FAILED")} ${chalk.dim(`(${connectionTest.endpoint})`)}`);
    logLine(chalk.dim(`  ${connectionTest.message}`));
  }

  if (!hadErrors) {
    logLine("");
    logLine(`${chalk.bold("Next step:")} Restart your AI clients, then paste this into any of them:`);
    logLine("");
    logLine(`"${firstPrompt}"`);
    logLine("");
  } else {
    logLine("");
    const failed = writes.filter((w) => w.action === "error");
    if (failed.length > 0) {
      logLine(chalk.bold("Errors:"));
      for (const w of failed) {
        logLine(`  ${BULLET} ${w.label}: ${chalk.red(w.message)}`);
      }
      logLine("");
    }
  }
}

export function printInstallDryRunHuman(opts: {
  plans: InstallPlan[];
  willStoreSharedKey?: boolean;
  firstPrompt: string;
}): void {
  logLine("");
  logLine(chalk.bold("Dry run — planned RiskModels MCP install"));
  logLine("");
  logLine(chalk.bold("Clients to merge into:"));
  for (const p of opts.plans) {
    const pathPart = p.configPath ? chalk.dim(` — ${p.configPath}`) : "";
    logLine(`  ${BULLET} ${p.label}${pathPart}`);
  }
  logLine("");
  if (opts.willStoreSharedKey) {
    logLine(
      chalk.dim(`A shared API key file would be created or updated at ${configPath()} (with backup if replacing).`),
    );
  } else {
    logLine(chalk.dim("No API key resolved — rerun with --api-key or set RISKMODELS_API_KEY after obtaining a key."));
    logLine(chalk.dim(API_KEY_EMAIL_HINT));
  }
  logLine("");
  logLine(chalk.dim("Rerun without --dry-run after you are happy with this plan."));
  logLine("");
  logLine(`${chalk.bold("First prompt to paste into your AI client:")} "${opts.firstPrompt}"`);
  logLine("");
}

export function printInstallMissingKeyHuman(): void {
  logLine("");
  logLine(chalk.red.bold("✗ Missing RiskModels API key"));
  logLine("");
  logLine(`Get a key: ${chalk.cyan("https://riskmodels.app/get-key")}`);
  logLine("");
  logLine(chalk.dim(API_KEY_EMAIL_HINT));
  logLine("");
  logLine(chalk.dim("Pass --api-key, set RISKMODELS_API_KEY, or rerun without --yes to enter it interactively."));
  logLine("");
}

export function printUninstallSuccessHuman(removals: ConfigWriteResult[]): void {
  logLine("");
  logLine(chalk.green.bold("✅ RiskModels MCP uninstall completed"));
  logLine("");
  logLine(chalk.bold("Updates to MCP configs:"));
  logLine("");
  for (const r of removals) {
    const bullet = `${BULLET} ${r.label}`;
    const pathSuffix = r.configPath ? chalk.dim(` — ${r.configPath}`) : "";
    if (r.action === "written") {
      logLine(`  ${bullet}${pathSuffix}`);
      logLine(chalk.green.dim(`      ${r.message}`));
      if (r.backupPath) logLine(chalk.dim(`      backup: ${r.backupPath}`));
    } else if (r.action === "skipped") {
      logLine(`  ${bullet}${pathSuffix}`);
      logLine(chalk.dim(`      (skipped — ${r.message})`));
    } else if (r.action === "error") {
      logLine(`  ${bullet}${pathSuffix}`);
      logLine(chalk.red(`      error: ${r.message}`));
    }
  }

  logLine("");
  logLine(`${chalk.bold("Shared API key:")} preserved ${chalk.dim(`(${configPath()} was not modified)`)}`);

  const backupPaths = removals.filter((r) => r.backupPath).map((r) => r.backupPath!);
  if (backupPaths.length > 0) {
    logLine("");
    logLine(chalk.bold("Backups stored:"));
    for (const line of formatBackupBullets(backupPaths)) logLine(`  ${line}`);
  }

  logLine("");
}

/** Human-readable detection list for uninstall dry-run (before removals computed). */
export function printUninstallPlannedHuman(detections: ClientDetection[]): void {
  logLine("");
  logLine(chalk.bold("Dry run — RiskModels MCP would be inspected on:"));
  logLine("");
  for (const d of detections) {
    logLine(`  ${BULLET} ${d.label}${d.configPath ? chalk.dim(` — ${d.configPath}`) : ""}`);
  }
  logLine("");
  logLine(
    chalk.dim(`Only the "riskmodels" MCP server block would be removed; ${configPath()} would not be touched.`),
  );
  logLine("");
}
