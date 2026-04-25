import { Command } from "commander";
import inquirer from "inquirer";
import chalk from "chalk";
import { configPath, loadConfig } from "../lib/config.js";
import { detectClients, selectedClients } from "../lib/mcp-config-paths.js";
import { buildInstallPlans, firstPrompt } from "../lib/mcp-install-plan.js";
import { printResults } from "../lib/display.js";
import { redactSecret } from "../lib/redact.js";

type InstallOptions = {
  client?: string;
  all?: boolean;
  apiKey?: string;
  dryRun?: boolean;
  yes?: boolean;
  embedKey?: boolean;
  json?: boolean;
};

function envApiKey(): string | undefined {
  return process.env.RISKMODELS_API_KEY?.trim() || undefined;
}

async function resolveApiKey(opts: InstallOptions): Promise<{ apiKey?: string; source: string }> {
  if (opts.apiKey?.trim()) return { apiKey: opts.apiKey.trim(), source: "--api-key" };
  const envKey = envApiKey();
  if (envKey) return { apiKey: envKey, source: "RISKMODELS_API_KEY" };
  const cfg = await loadConfig();
  if (cfg?.apiKey?.trim()) return { apiKey: cfg.apiKey.trim(), source: configPath() };
  if (opts.yes) return { source: "missing" };

  console.error(chalk.yellow("No RiskModels API key found."));
  console.error(chalk.dim("Get a key: https://riskmodels.app/get-api-key"));
  const answer = await inquirer.prompt<{ apiKey: string }>([
    {
      type: "password",
      name: "apiKey",
      message: "RiskModels API key",
      mask: "*",
      validate: (value: string) => (value.trim() ? true : "API key is required"),
    },
  ]);
  return { apiKey: answer.apiKey.trim(), source: "prompt" };
}

export function installCommand(): Command {
  return new Command("install")
    .description("Detect AI clients and install/register the RiskModels MCP server")
    .option("--client <name>", "claude | cursor | codex | vscode")
    .option("--all", "Target all detected clients")
    .option("--api-key <key>", "RiskModels API key for one-shot setup")
    .option("--dry-run", "Show planned config changes without writing")
    .option("--yes", "Non-interactive mode")
    .option("--embed-key", "Explicitly embed the API key in MCP config env (not recommended)")
    .option("--json", "JSON output")
    .action(async (opts: InstallOptions, cmd: Command) => {
      const json = opts.json || (cmd.optsWithGlobals() as { json?: boolean }).json || false;
      let clients;
      try {
        clients = selectedClients({ client: opts.client, all: opts.all });
      } catch (error) {
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
        return;
      }

      const dryRun = opts.dryRun ?? true;
      const { apiKey, source } = await resolveApiKey(opts);
      const detections = await detectClients(clients);
      const plans = buildInstallPlans(detections, { apiKey, embedKey: opts.embedKey });

      const output = {
        dryRun,
        apiKey: {
          found: !!apiKey,
          source,
          value: redactSecret(apiKey),
          storage: configPath(),
          willStoreInSharedConfig: !!apiKey && source !== configPath() && !dryRun,
          embeddedInMcpConfig: !!opts.embedKey,
        },
        clients: plans,
        firstPrompt: firstPrompt(),
        nextStep: dryRun
          ? "Review this plan, then rerun without --dry-run once safe-write support is enabled."
          : "Safe-write support is not enabled in this release slice; rerun with --dry-run.",
      };

      if (!dryRun) {
        printResults(output, json);
        console.error(chalk.yellow("Config writes are intentionally deferred. Use `riskmodels install --dry-run` for now."));
        process.exitCode = 1;
        return;
      }

      printResults(output, json);
      if (!json) {
        console.error(chalk.green(`First prompt to try: "${firstPrompt()}"`));
      }
    });
}
