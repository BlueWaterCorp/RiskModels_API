import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../lib/config.js";
import { requireResolvedAuth } from "../lib/credentials.js";
import { apiFetchJson } from "../lib/api-client.js";
import { printResults } from "../lib/display.js";

export function correlationCommand(): Command {
  const corr = new Command("correlation").description("Macro factor correlation (POST /correlation, GET /metrics/.../correlation)");

  corr
    .command("post")
    .description("Batch or single ticker correlation vs macro factors (POST /correlation)")
    .requiredOption("--ticker <sym>", "One ticker, or comma-separated list (max 50)")
    .option("--factors <list>", "Comma-separated factor keys (default: all six)")
    .option("--return-type <t>", "gross | l1 | l2 | l3_residual", "l3_residual")
    .option("--window-days <n>", "Rolling window length", "252")
    .option("--method <m>", "pearson | spearman", "pearson")
    .action(
      async (
        opts: { ticker: string; factors?: string; returnType?: string; windowDays?: string; method?: string },
        cmd: Command,
      ) => {
        const json = (cmd.optsWithGlobals() as { json?: boolean }).json ?? false;
        const cfg = await loadConfig();
        const auth = requireResolvedAuth(cfg, chalk.yellow);
        if (!auth) return;

        const tickersStr = opts.ticker.trim();
        const tickersParts = tickersStr.split(/[\s,]+/).filter(Boolean);
        const tickerField: string | string[] = tickersParts.length > 1 ? tickersParts : tickersStr;

        const body: Record<string, unknown> = {
          ticker: tickerField,
          return_type: opts.returnType ?? "l3_residual",
          window_days: parseInt(String(opts.windowDays ?? "252"), 10) || 252,
          method: opts.method ?? "pearson",
        };
        if (opts.factors?.trim()) {
          body.factors = opts.factors.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
        }

        try {
          const { body: resBody, costUsd } = await apiFetchJson(auth, "POST", "/correlation", { jsonBody: body });
          printResults(resBody, json);
          if (!json && costUsd) console.log(chalk.dim(`Cost: $${costUsd}`));
        } catch (e) {
          console.error(chalk.red(e instanceof Error ? e.message : String(e)));
          process.exitCode = 1;
        }
      },
    );

  corr
    .command("metrics")
    .description("Single-ticker correlation via GET /metrics/{ticker}/correlation")
    .argument("<ticker>", "Symbol")
    .option("--factors <list>", "Comma-separated macro keys")
    .option("--return-type <t>", "gross | l1 | l2 | l3_residual", "l3_residual")
    .option("--window-days <n>", "Default 252", "252")
    .option("--method <m>", "pearson | spearman", "pearson")
    .action(
      async (
        ticker: string,
        opts: { factors?: string; returnType?: string; windowDays?: string; method?: string },
        cmd: Command,
      ) => {
        const json = (cmd.optsWithGlobals() as { json?: boolean }).json ?? false;
        const cfg = await loadConfig();
        const auth = requireResolvedAuth(cfg, chalk.yellow);
        if (!auth) return;

        const enc = encodeURIComponent(ticker.trim());
        const query: Record<string, string | number | undefined> = {
          return_type: opts.returnType ?? "l3_residual",
          window_days: parseInt(String(opts.windowDays ?? "252"), 10) || 252,
          method: opts.method ?? "pearson",
        };
        if (opts.factors?.trim()) query.factors = opts.factors.trim();

        try {
          const { body, costUsd } = await apiFetchJson(auth, "GET", `/metrics/${enc}/correlation`, { query });
          printResults(body, json);
          if (!json && costUsd) console.log(chalk.dim(`Cost: $${costUsd}`));
        } catch (e) {
          console.error(chalk.red(e instanceof Error ? e.message : String(e)));
          process.exitCode = 1;
        }
      },
    );

  return corr;
}
