import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../lib/config.js";
import { requireResolvedAuth } from "../lib/credentials.js";
import { apiFetchJson } from "../lib/api-client.js";
import { printResults } from "../lib/display.js";

export function estimateCommand(): Command {
  return new Command("estimate")
    .description("Estimate request cost before calling a metered endpoint (POST /estimate)")
    .requiredOption("--endpoint <name>", "Target endpoint slug, e.g. ticker-returns, batch-analyze")
    .option("--params-json <json>", "JSON object of params for the target endpoint (string)")
    .action(async (opts: { endpoint: string; paramsJson?: string }, cmd: Command) => {
      const json = (cmd.optsWithGlobals() as { json?: boolean }).json ?? false;
      const cfg = await loadConfig();
      const auth = requireResolvedAuth(cfg, chalk.yellow);
      if (!auth) return;

      let params: Record<string, unknown> = {};
      if (opts.paramsJson?.trim()) {
        try {
          params = JSON.parse(opts.paramsJson) as Record<string, unknown>;
        } catch {
          console.error(chalk.red("Invalid --params-json (must be JSON)."));
          process.exitCode = 1;
          return;
        }
      }

      try {
        const { body } = await apiFetchJson(auth, "POST", "/estimate", {
          jsonBody: { endpoint: opts.endpoint, params },
        });
        printResults(body, json);
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
      }
    });
}
