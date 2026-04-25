import { Command } from "commander";
import { configPath, loadConfig, maskSecret } from "../lib/config.js";
import { detectClients, selectedClients } from "../lib/mcp-config-paths.js";
import { printResults } from "../lib/display.js";

export function statusCommand(): Command {
  return new Command("status")
    .description("Show RiskModels CLI and MCP client configuration status")
    .option("--client <name>", "claude | cursor | codex | vscode")
    .option("--all", "Check all supported clients")
    .option("--json", "JSON output")
    .action(async (opts: { client?: string; all?: boolean; json?: boolean }, cmd: Command) => {
      const json = opts.json || (cmd.optsWithGlobals() as { json?: boolean }).json || false;
      const cfg = await loadConfig();
      const clients = selectedClients({ client: opts.client, all: opts.all });
      const detections = await detectClients(clients);

      printResults(
        {
          configPath: configPath(),
          configFound: !!cfg,
          apiBaseUrl: cfg?.apiBaseUrl ?? "https://riskmodels.app",
          apiKey: maskSecret(cfg?.apiKey),
          oauthConfigured: !!cfg?.clientId && !!cfg?.clientSecret,
          mcpClients: detections,
        },
        json,
      );
    });
}
