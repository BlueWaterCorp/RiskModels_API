import { Command } from "commander";
import { configPath, loadConfig, maskSecret } from "../lib/config.js";
import { detectClients, selectedClients } from "../lib/mcp-config-paths.js";
import { printResults } from "../lib/display.js";
import { printStatusHuman } from "../lib/cli-human-diagnostics.js";
import { warnIfGlobalJsonBeforeSubcommand } from "../lib/global-json-hint.js";

export function statusCommand(): Command {
  return new Command("status")
    .description(
      "Show RiskModels CLI and MCP client configuration status (default: readable summary; use --json for scripts)",
    )
    .option("--client <name>", "claude | cursor | codex | vscode")
    .option("--all", "Check all supported clients")
    .option("--json", "Structured JSON instead of readable summary")
    .action(async (opts: { client?: string; all?: boolean; json?: boolean }, cmd: Command) => {
      const json = opts.json || (cmd.optsWithGlobals() as { json?: boolean }).json || false;
      const cfg = await loadConfig();
      const clients = selectedClients({ client: opts.client, all: opts.all });
      const detections = await detectClients(clients);

      const payload = {
        configPath: configPath(),
        configFound: !!cfg,
        apiBaseUrl: cfg?.apiBaseUrl ?? "https://riskmodels.app",
        apiKey: maskSecret(cfg?.apiKey),
        oauthConfigured: !!cfg?.clientId && !!cfg?.clientSecret,
        mcpClients: detections,
      };

      if (json) {
        warnIfGlobalJsonBeforeSubcommand("status");
        printResults(payload, json);
      } else {
        printStatusHuman(payload);
      }
    });
}
