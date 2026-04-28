import { spawnSync } from "node:child_process";
import { Command } from "commander";
import { configPath, loadConfig, maskSecret } from "../lib/config.js";
import { detectClients } from "../lib/mcp-config-paths.js";
import { printResults } from "../lib/display.js";

function commandOk(command: string, args = ["--version"]): boolean {
  const result = spawnSync(command, args, { stdio: "ignore" });
  return result.status === 0 || result.status === 1;
}

export function doctorCommand(): Command {
  return new Command("doctor")
    .description("Run local diagnostics for RiskModels CLI and MCP install readiness")
    .option("--json", "JSON output")
    .action(async (opts: { json?: boolean }, cmd: Command) => {
      const json = opts.json || (cmd.optsWithGlobals() as { json?: boolean }).json || false;
      const cfg = await loadConfig();
      const clients = await detectClients(["claude", "cursor", "codex", "vscode"]);
      const checks = [
        {
          id: "node",
          ok: true,
          detail: process.version,
        },
        {
          id: "npx",
          ok: commandOk("npx"),
          detail: "Required so MCP configs can run `npx -y @riskmodels/mcp` (stdio server from `riskmodels install`).",
        },
        {
          id: "api_credentials",
          ok: !!cfg?.apiKey || !!process.env.RISKMODELS_API_KEY || (!!cfg?.clientId && !!cfg?.clientSecret),
          detail: cfg?.apiKey
            ? `Config API key ${maskSecret(cfg.apiKey)} in ${configPath()}`
            : process.env.RISKMODELS_API_KEY
              ? "RISKMODELS_API_KEY is set in the environment."
              : "No API key found. Get one at https://riskmodels.app/get-key",
        },
        {
          id: "mcp_package_target",
          ok: true,
          detail: "`riskmodels install` merges `npx -y @riskmodels/mcp` into detected client configs (stdio MCP).",
        },
      ];

      printResults(
        {
          ok: checks.every((check) => check.ok),
          checks,
          clients,
          note: "Run `riskmodels install --dry-run` to inspect config writes, or `riskmodels install` to write configs with backups and run a connection test.",
        },
        json,
      );
    });
}
