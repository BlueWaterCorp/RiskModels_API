import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../lib/config.js";
import { requireResolvedAuth } from "../lib/credentials.js";
import { apiFetchJson } from "../lib/api-client.js";
import { printResults } from "../lib/display.js";

export function returnsCommand(): Command {
  const ret = new Command("returns").description(
    "Return time series for stocks and ETFs (GET /ticker-returns)",
  );

  ret
    .command("ticker")
    .description(
      "Daily returns for a stock or ETF (GET /ticker-returns). Stocks include L3 hedge ratios; ETFs return date/returns_gross/price_close only.",
    )
    .argument("<ticker>", "Symbol, e.g. NVDA or SPY")
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

  // Deprecated aliases: /returns and /etf-returns were removed. Forward to
  // /ticker-returns (which now accepts both stocks and ETFs) and print a notice.
  ret
    .command("stock")
    .description("DEPRECATED: alias for 'returns ticker'. Forwards to GET /ticker-returns.")
    .argument("<ticker>", "Symbol")
    .option("--years <n>", "Years of history (1–15)", "1")
    .action(async (ticker: string, opts: { years?: string }, cmd: Command) => {
      console.error(
        chalk.yellow(
          "[deprecated] 'returns stock' is now an alias for 'returns ticker'. /returns was removed.",
        ),
      );
      const years = parseInt(String(opts.years ?? "1"), 10) || 1;
      await runReturns(cmd, "/ticker-returns", {
        ticker: ticker.trim(),
        years,
        format: "json",
      });
    });

  ret
    .command("etf")
    .description("DEPRECATED: alias for 'returns ticker'. Forwards to GET /ticker-returns (ETFs now flow through /ticker-returns).")
    .argument("<etf>", "ETF symbol, e.g. SPY")
    .option("--years <n>", "Years of history (1–15)", "1")
    .action(async (etf: string, opts: { years?: string }, cmd: Command) => {
      console.error(
        chalk.yellow(
          "[deprecated] 'returns etf' is now an alias for 'returns ticker'. /etf-returns was removed; ETFs are served via /ticker-returns.",
        ),
      );
      const years = parseInt(String(opts.years ?? "1"), 10) || 1;
      await runReturns(cmd, "/ticker-returns", {
        ticker: etf.trim(),
        years,
        format: "json",
      });
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
