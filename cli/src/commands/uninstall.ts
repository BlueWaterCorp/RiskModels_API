import { Command } from "commander";
import chalk from "chalk";
import { detectClients, selectedClients } from "../lib/mcp-config-paths.js";
import { printResults } from "../lib/display.js";
import { uninstallMcpConfig } from "../lib/mcp-config-writer.js";

export function uninstallCommand(): Command {
  return new Command("uninstall")
    .description("Remove the RiskModels MCP server from client configs")
    .option("--client <name>", "claude | cursor | codex | vscode")
    .option("--all", "Check all supported clients")
    .option("--dry-run", "Show planned removals without writing")
    .option("--json", "JSON output")
    .action(async (opts: { client?: string; all?: boolean; dryRun?: boolean; json?: boolean }, cmd: Command) => {
      const json = opts.json || (cmd.optsWithGlobals() as { json?: boolean }).json || false;
      const clients = selectedClients({ client: opts.client, all: opts.all });
      const detections = await detectClients(clients);
      const dryRun = opts.dryRun ?? false;
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

      if (dryRun) {
        printResults(output, json);
        return;
      }

      const removals = await Promise.all(detections.map((detection) => uninstallMcpConfig(detection)));
      printResults({ ...output, removals }, json);
      if (removals.some((removal) => removal.action === "error")) {
        process.exitCode = 1;
        return;
      }
      if (!json) {
        console.error(chalk.green("RiskModels MCP uninstall completed with backups where files changed."));
      }
    });
}
