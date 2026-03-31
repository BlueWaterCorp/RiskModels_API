import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../lib/config.js";
import { requireResolvedAuth } from "../lib/credentials.js";
import { apiFetchJson } from "../lib/api-client.js";
import { printResults } from "../lib/display.js";

export function l3Command(): Command {
  return new Command("l3")
    .description("L3 factor decomposition time series (GET /l3-decomposition)")
    .argument("<ticker>", "Symbol")
    .option("--market-factor-etf <sym>", "Market factor ETF (default SPY)", "SPY")
    .action(async (ticker: string, opts: { marketFactorEtf?: string }, cmd: Command) => {
      const json = (cmd.optsWithGlobals() as { json?: boolean }).json ?? false;
      const cfg = await loadConfig();
      const auth = requireResolvedAuth(cfg, chalk.yellow);
      if (!auth) return;

      const query: Record<string, string | undefined> = {
        ticker: ticker.trim(),
        market_factor_etf: opts.marketFactorEtf ?? "SPY",
      };

      try {
        const { body, costUsd } = await apiFetchJson(auth, "GET", "/l3-decomposition", { query });
        printResults(body, json);
        if (!json && costUsd) console.log(chalk.dim(`Cost: $${costUsd}`));
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
      }
    });
}
