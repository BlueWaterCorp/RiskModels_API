import { Command } from "commander";
import chalk from "chalk";
import { detectClients, selectedClients } from "../lib/mcp-config-paths.js";
import { printResults } from "../lib/display.js";

export function uninstallCommand(): Command {
  return new Command("uninstall")
    .description("Plan removal of the RiskModels MCP server from client configs")
    .option("--client <name>", "claude | cursor | codex | vscode")
    .option("--all", "Check all supported clients")
    .option("--dry-run", "Show planned removals without writing", true)
    .option("--json", "JSON output")
    .action(async (opts: { client?: string; all?: boolean; dryRun?: boolean; json?: boolean }, cmd: Command) => {
      const json = opts.json || (cmd.optsWithGlobals() as { json?: boolean }).json || false;
      const clients = selectedClients({ client: opts.client, all: opts.all });
      const detections = await detectClients(clients);
      const dryRun = opts.dryRun !== false;
      const output = {
        dryRun,
        plannedAction: "Remove only the `riskmodels` MCP server block from detected client configs.",
        preservesSharedApiKey: true,
        clients: detections.map((detection) => ({
          client: detection.client,
          label: detection.label,
          configPath: detection.configPath,
          mode: detection.mode,
          status: detection.status,
          notes: detection.notes,
        })),
      };

      printResults(output, json);
      if (!dryRun) {
        console.error(chalk.yellow("Config removal is intentionally deferred until safe-write support lands."));
        process.exitCode = 1;
      }
    });
}
