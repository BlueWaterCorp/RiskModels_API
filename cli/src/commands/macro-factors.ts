import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../lib/config.js";
import { requireResolvedAuth } from "../lib/credentials.js";
import { apiFetchJson } from "../lib/api-client.js";
import { printResults } from "../lib/display.js";

export function macroFactorsCommand(): Command {
  return new Command("macro-factors")
    .description("Daily macro factor returns from macro_factors (GET /macro-factors, no ticker)")
    .option("--factors <list>", "Comma-separated factor keys (default: all six)")
    .option("--start <date>", "Inclusive YYYY-MM-DD")
    .option("--end <date>", "Inclusive YYYY-MM-DD")
    .action(
      async (
        opts: { factors?: string; start?: string; end?: string },
        cmd: Command,
      ) => {
        const json = (cmd.optsWithGlobals() as { json?: boolean }).json ?? false;
        const cfg = await loadConfig();
        const auth = requireResolvedAuth(cfg, chalk.yellow);
        if (!auth) return;

        const query: Record<string, string | undefined> = {};
        if (opts.factors?.trim()) query.factors = opts.factors.trim();
        if (opts.start?.trim()) query.start = opts.start.trim();
        if (opts.end?.trim()) query.end = opts.end.trim();

        try {
          const { body, costUsd } = await apiFetchJson(auth, "GET", "/macro-factors", {
            query,
          });
          printResults(body, json);
          if (!json && costUsd) console.log(chalk.dim(`Cost: $${costUsd}`));
        } catch (e) {
          console.error(chalk.red(e instanceof Error ? e.message : String(e)));
          process.exitCode = 1;
        }
      },
    );
}
