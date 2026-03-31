import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../lib/config.js";
import { apiRootFromUserBase } from "../lib/api-url.js";
import { apiFetchOptionalAuth } from "../lib/api-client.js";
import { printResults } from "../lib/display.js";

export function tickersCommand(): Command {
  return new Command("tickers")
    .description("Ticker universe search (GET /tickers, no auth required)")
    .option("--search <q>", "Match symbol or company name")
    .option("--mag7", "MAG7 names only")
    .option("--metadata", "Include sector / ETF metadata")
    .option("--array <name>", "ticker | teo (full symbol list or trading dates)")
    .action(async (opts: { search?: string; mag7?: boolean; metadata?: boolean; array?: string }, cmd: Command) => {
      const json = (cmd.optsWithGlobals() as { json?: boolean }).json ?? false;
      const cfg = await loadConfig();
      const apiRoot = apiRootFromUserBase(cfg?.apiBaseUrl);

      const query: Record<string, string | number | boolean | undefined> = {};
      if (opts.search) query.search = opts.search;
      if (opts.mag7) query.mag7 = true;
      if (opts.metadata) query.include_metadata = true;
      if (opts.array) query.array = opts.array;

      try {
        const { body } = await apiFetchOptionalAuth(apiRoot, "GET", "/tickers", { query });
        printResults(body, json);
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
      }
    });
}
