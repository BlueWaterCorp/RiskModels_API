import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../lib/config.js";
import { requireResolvedAuth } from "../lib/credentials.js";
import { apiFetchJson } from "../lib/api-client.js";
import { printResults } from "../lib/display.js";

export function metricsCommand(): Command {
  return new Command("metrics")
    .description("Latest risk metrics snapshot for one ticker (GET /metrics/{ticker})")
    .argument("<ticker>", "Ticker symbol, e.g. NVDA")
    .action(async (ticker: string, _opts: unknown, cmd: Command) => {
      const json = (cmd.optsWithGlobals() as { json?: boolean }).json ?? false;
      const cfg = await loadConfig();
      const auth = requireResolvedAuth(cfg, chalk.yellow);
      if (!auth) return;
      const enc = encodeURIComponent(ticker.trim());
      try {
        const { body, costUsd } = await apiFetchJson(auth, "GET", `/metrics/${enc}`);
        printResults(body, json);
        if (!json && costUsd) console.log(chalk.dim(`Cost: $${costUsd}`));
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
      }
    });
}
