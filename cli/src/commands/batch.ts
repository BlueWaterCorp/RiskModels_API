import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../lib/config.js";
import { requireResolvedAuth } from "../lib/credentials.js";
import { apiFetchJson } from "../lib/api-client.js";
import { printResults } from "../lib/display.js";

const METRIC_CHOICES = ["returns", "l3_decomposition", "hedge_ratios", "full_metrics"] as const;

function parseTickers(s: string): string[] {
  return s
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function parseMetrics(s: string | undefined): string[] {
  if (!s?.trim()) return ["full_metrics"];
  const parts = s.split(/[\s,]+/).map((x) => x.trim());
  for (const p of parts) {
    if (!METRIC_CHOICES.includes(p as (typeof METRIC_CHOICES)[number])) {
      throw new Error(`Invalid metric "${p}". Use: ${METRIC_CHOICES.join(", ")}`);
    }
  }
  return parts;
}

export function batchCommand(): Command {
  const batch = new Command("batch").description("Multi-ticker batch analysis (POST /batch/analyze)");

  batch
    .command("analyze")
    .description("Fetch metrics for up to 100 tickers")
    .requiredOption("--tickers <symbols>", "Comma or space separated tickers, e.g. AAPL,MSFT,NVDA")
    .option(
      "--metrics <list>",
      `Comma-separated: ${METRIC_CHOICES.join(", ")} (default: full_metrics)`,
    )
    .option("--years <n>", "Years of history for returns / l3_decomposition", "1")
    .option("--format <fmt>", "json | parquet | csv", "json")
    .action(async (opts: { tickers: string; metrics?: string; years?: string; format?: string }, cmd: Command) => {
      const json = (cmd.optsWithGlobals() as { json?: boolean }).json ?? false;
      const cfg = await loadConfig();
      const auth = requireResolvedAuth(cfg, chalk.yellow);
      if (!auth) return;

      let metrics: string[];
      try {
        metrics = parseMetrics(opts.metrics);
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
        return;
      }

      const years = parseInt(String(opts.years ?? "1"), 10) || 1;
      const format = (opts.format ?? "json") as "json" | "parquet" | "csv";
      const tickers = parseTickers(opts.tickers);
      if (tickers.length === 0 || tickers.length > 100) {
        console.error(chalk.red("Provide 1–100 tickers."));
        process.exitCode = 1;
        return;
      }

      if (format !== "json") {
        console.error(chalk.red("CLI supports JSON responses only; omit --format or use --format json."));
        process.exitCode = 1;
        return;
      }

      try {
        const { body, costUsd } = await apiFetchJson(auth, "POST", "/batch/analyze", {
          jsonBody: { tickers, metrics, years, format: "json" },
        });
        printResults(body, json);
        if (!json && costUsd) console.log(chalk.dim(`Cost: $${costUsd}`));
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
      }
    });

  return batch;
}
