import chalk from "chalk";
import { platform } from "node:os";
import type { SharedConfigWriteResult, ConfigWriteResult } from "./mcp-config-writer.js";
import type { InstallPlan } from "./mcp-install-plan.js";
import type { ClientDetection } from "./mcp-config-paths.js";
import { configPath } from "./config.js";
import { getCliPackageVersion } from "./cli-version.js";
import { abbreviatePath } from "./path-display.js";

const BULLET = "•";

/** Shown wherever we direct users to obtain an API key (matches key-issued email sender). */
export const API_KEY_EMAIL_HINT =
  "If you requested a key already, check your inbox for mail from RiskModels (service@riskmodels.app).";

function logRiskmodelsCliFooter(phase: "done" | "dry-run"): void {
  logLine("");
  logLine(chalk.bold("riskmodels CLI (still on PATH):"));
  logLine(
    chalk.dim(
      phase === "dry-run"
        ? "Uninstalling MCP only edits AI client configs; it does not remove the riskmodels terminal command."
        : 'The RiskModels MCP integration was removed from the configs above. The "riskmodels" terminal command was not.',
    ),
  );
  logLine(chalk.dim("To remove the CLI, use what matches how you installed it:"));
  if (platform() !== "win32") {
    logLine(chalk.dim(`  ${BULLET} Homebrew (macOS / Linux): brew uninstall riskmodels`));
  }
  logLine(chalk.dim(`  ${BULLET} npm (any OS): npm uninstall -g riskmodels`));
  if (platform() === "win32") {
    logLine(
      chalk.dim(
        `  ${BULLET} Package manager installs (winget / Chocolatey / Scoop / etc.): use that tool's uninstall`,
      ),
    );
  }
  logLine("");
  logLine(chalk.dim(`riskmodels CLI ${getCliPackageVersion()}`));
}

function logLine(line = ""): void {
  console.log(line);
}

function formatBackupBullets(paths: string[]): string[] {
  return paths
    .filter(Boolean)
    .sort()
    .map((p) => `${BULLET} ${abbreviatePath(p)}`);
}

export function printInstallSuccessHuman(opts: {
  isFirstInstall: boolean;
  writes: ConfigWriteResult[];
  sharedConfigWrite: SharedConfigWriteResult;
  connectionTest: { ok: boolean; endpoint: string; message: string };
  firstPrompt: string;
  hadErrors: boolean;
  /** When Claude CLI is detected, suggest native `claude mcp` as an alternative. */
  showClaudeCodeMcpTip?: boolean;
}): void {
  const {
    isFirstInstall,
    writes,
    sharedConfigWrite,
    connectionTest,
    firstPrompt,
    hadErrors,
    showClaudeCodeMcpTip,
  } = opts;

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

  if (showClaudeCodeMcpTip) {
    logLine("");
    logLine(`${chalk.bold("Claude Code:")}`);
    logLine(
      chalk.dim(
        "CLI detected — you may prefer registering MCP with: claude mcp add … (see RiskModels quickstart); merged files above still apply to Claude Desktop.",
      ),
    );
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
    logLine(`${chalk.bold("Connection test:")} OK (${chalk.cyan(connectionTest.endpoint)})`);
  } else {
    logLine(`${chalk.bold("Connection test:")} ${chalk.red("FAILED")} ${chalk.dim(`(${connectionTest.endpoint})`)}`);
    logLine(chalk.dim(`  ${connectionTest.message}`));
    logLine(
      chalk.dim(
        "Tip: check network/VPN, apiBaseUrl in shared config if non-default, corporate proxy, then run: riskmodels health",
      ),
    );
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

  logLine(chalk.dim(`riskmodels CLI ${getCliPackageVersion()}`));
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
    const pathPart = p.configPath ? chalk.dim(` — ${abbreviatePath(p.configPath)}`) : "";
    logLine(`  ${BULLET} ${p.label}${pathPart}`);
  }
  logLine("");
  const cfgAbs = configPath();
  const cfgShort = abbreviatePath(cfgAbs);
  if (opts.willStoreSharedKey) {
    logLine(chalk.dim(`A shared API key file would be created or updated at ${cfgShort}`));
    if (cfgShort !== cfgAbs) logLine(chalk.dim(`  (full path: ${cfgAbs})`));
    logLine(chalk.dim("(with backup if replacing)."));
  } else {
    logLine(chalk.dim("No API key resolved — rerun with --api-key or set RISKMODELS_API_KEY after obtaining a key."));
    logLine(chalk.dim(API_KEY_EMAIL_HINT));
  }
  logLine("");
  logLine(chalk.dim("Rerun without --dry-run after you are happy with this plan."));
  logLine("");
  logLine(`${chalk.bold("First prompt to paste into your AI client:")} "${opts.firstPrompt}"`);
  logLine("");
  logLine(chalk.dim(`riskmodels CLI ${getCliPackageVersion()}`));
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
  logLine(chalk.dim(`riskmodels CLI ${getCliPackageVersion()}`));
}

export function printUninstallSuccessHuman(removals: ConfigWriteResult[]): void {
  logLine("");
  logLine(chalk.green.bold("✅ RiskModels MCP uninstall completed"));
  logLine("");
  logLine(chalk.bold("Updates to MCP configs:"));
  logLine("");
  for (const r of removals) {
    const bullet = `${BULLET} ${r.label}`;
    const pathSuffix =
      r.configPath !== undefined ? chalk.dim(` — ${abbreviatePath(r.configPath)}`) : "";
    if (r.action === "written") {
      logLine(`  ${bullet}${pathSuffix}`);
      logLine(chalk.green.dim(`      ${r.message}`));
      if (r.backupPath) logLine(chalk.dim(`      backup: ${abbreviatePath(r.backupPath)}`));
    } else if (r.action === "skipped") {
      logLine(`  ${bullet}${pathSuffix}`);
      logLine(chalk.dim(`      (skipped — ${r.message})`));
    } else if (r.action === "error") {
      logLine(`  ${bullet}${pathSuffix}`);
      logLine(chalk.red(`      error: ${r.message}`));
    }
  }

  logLine("");
  const sharedAbs = configPath();
  const sharedShort = abbreviatePath(sharedAbs);
  logLine(`${chalk.bold("Shared API key / billing profile:")} unchanged ${chalk.dim(`(${sharedShort})`)}`);
  if (sharedShort !== sharedAbs) {
    logLine(chalk.dim(`  (full path: ${sharedAbs})`));
  }
  logLine(
    chalk.dim(
      "Only the riskmodels MCP server block was removed from each AI client config above; your key file was not modified.",
    ),
  );

  const backupPaths = removals.filter((r) => r.backupPath).map((r) => r.backupPath!);
  if (backupPaths.length > 0) {
    logLine("");
    logLine(chalk.bold("Backups stored:"));
    for (const line of formatBackupBullets(backupPaths)) logLine(`  ${line}`);
  }

  logRiskmodelsCliFooter("done");
}

/** Human-readable detection list for uninstall dry-run (before removals computed). */
export function printUninstallPlannedHuman(detections: ClientDetection[]): void {
  logLine("");
  logLine(chalk.bold("Dry run — RiskModels MCP would be inspected on:"));
  logLine("");
  for (const d of detections) {
    const p = d.configPath ? chalk.dim(` — ${abbreviatePath(d.configPath)}`) : "";
    logLine(`  ${BULLET} ${d.label}${p}`);
  }
  logLine("");
  const sharedAbs = configPath();
  const sharedShort = abbreviatePath(sharedAbs);
  logLine(
    chalk.dim(
      `Only the "riskmodels" MCP server block would be removed; ${sharedShort} would not be touched.`,
    ),
  );
  if (sharedShort !== sharedAbs) logLine(chalk.dim(`  (full path: ${sharedAbs})`));
  logRiskmodelsCliFooter("dry-run");
}
