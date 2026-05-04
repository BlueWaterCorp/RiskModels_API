import { Command } from "commander";
import { detectClients, selectedClients } from "../lib/mcp-config-paths.js";
import { printResults } from "../lib/display.js";
import {
  printUninstallPlannedHuman,
  printUninstallSuccessHuman,
} from "../lib/mcp-cli-human-output.js";
import { uninstallMcpConfig } from "../lib/mcp-config-writer.js";

export function uninstallCommand(): Command {
  return new Command("uninstall")
    .description(
      "Remove the RiskModels MCP server from client configs (default: friendly summary; pass --json for machine-readable)",
    )
    .option("--client <name>", "claude | cursor | codex | vscode")
    .option("--all", "Check all supported clients")
    .option("--dry-run", "Show planned removals without writing")
    .option("--json", "Structured JSON instead of formatted text (matches historical output shape)")
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
        if (json) {
          printResults(output, json);
        } else {
          printUninstallPlannedHuman(detections);
        }
        return;
      }

      const removals = await Promise.all(detections.map((detection) => uninstallMcpConfig(detection)));
      if (json) {
        printResults({ ...output, removals }, json);
      } else {
        printUninstallSuccessHuman(removals);
      }
      if (removals.some((removal) => removal.action === "error")) {
        process.exitCode = 1;
        return;
      }
    });
}
