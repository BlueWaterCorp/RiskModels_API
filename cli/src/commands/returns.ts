import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../lib/config.js";
import { requireResolvedAuth } from "../lib/credentials.js";
import { apiFetchJson } from "../lib/api-client.js";
import { printResults } from "../lib/display.js";

export function returnsCommand(): Command {
  const ret = new Command("returns").description("Return time series (GET /ticker-returns, /returns, /etf-returns)");

  ret
    .command("ticker")
    .description("Daily returns with L3 hedge ratios (GET /ticker-returns)")
    .argument("<ticker>", "Symbol, e.g. NVDA")
    .option("--years <n>", "Years of history (1–15)", "1")
    .option("--limit <n>", "Max rows")
    .option("--nocache", "Bypass cache")
    .action(async (ticker: string, opts: { years?: string; limit?: string; nocache?: boolean }, cmd: Command) => {
      const years = parseInt(String(opts.years ?? "1"), 10) || 1;
      const query: Record<string, string | number | boolean | undefined> = {
        ticker: ticker.trim(),
        years,
        format: "json",
      };
      if (opts.limit) query.limit = parseInt(opts.limit, 10);
      if (opts.nocache) query.nocache = true;
      await runReturns(cmd, "/ticker-returns", query);
    });

  ret
    .command("stock")
    .description("Daily gross returns only (GET /returns)")
    .argument("<ticker>", "Symbol")
    .action(async (ticker: string, _opts: unknown, cmd: Command) => {
      await runReturns(cmd, "/returns", { ticker: ticker.trim(), format: "json" });
    });

  ret
    .command("etf")
    .description("Daily ETF gross returns (GET /etf-returns)")
    .argument("<etf>", "ETF symbol, e.g. SPY")
    .action(async (etf: string, _opts: unknown, cmd: Command) => {
      await runReturns(cmd, "/etf-returns", { etf: etf.trim(), format: "json" });
    });

  return ret;
}

async function runReturns(
  cmd: Command,
  path: string,
  query: Record<string, string | number | boolean | undefined>,
): Promise<void> {
  const json = (cmd.optsWithGlobals() as { json?: boolean }).json ?? false;
  const cfg = await loadConfig();
  const auth = requireResolvedAuth(cfg, chalk.yellow);
  if (!auth) return;

  try {
    const { body, costUsd } = await apiFetchJson(auth, "GET", path, { query });
    printResults(body, json);
    if (!json && costUsd) console.log(chalk.dim(`Cost: $${costUsd}`));
  } catch (e) {
    console.error(chalk.red(e instanceof Error ? e.message : String(e)));
    process.exitCode = 1;
  }
}
