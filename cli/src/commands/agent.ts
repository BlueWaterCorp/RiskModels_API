import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../lib/config.js";
import { requireResolvedAuth } from "../lib/credentials.js";
import { apiFetchJson } from "../lib/api-client.js";
import { printResults } from "../lib/display.js";

const DOCS = "https://riskmodels.app/docs/api";

function parseTickers(s: string): string[] {
  return s
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function agentCommand(): Command {
  const agent = new Command("agent").description(
    "Shortcuts for portfolio-style workflows (wraps REST endpoints)",
  );

  agent
    .command("decompose")
    .description(
      "Batch L3-style screen: POST /batch/analyze with full_metrics (+ hedge_ratios)",
    )
    .requiredOption(
      "--tickers <symbols>",
      "Comma or space separated tickers (max 100)",
    )
    .option("--years <n>", "Years when returns blocks are requested", "1")
    .action(async (opts: { tickers: string; years?: string }, cmd: Command) => {
      const json = (cmd.optsWithGlobals() as { json?: boolean }).json ?? false;
      const cfg = await loadConfig();
      const auth = requireResolvedAuth(cfg, chalk.yellow);
      if (!auth) return;

      const tickers = parseTickers(opts.tickers);
      if (tickers.length === 0 || tickers.length > 100) {
        console.error(chalk.red("Provide 1–100 tickers."));
        process.exitCode = 1;
        return;
      }
      const years = parseInt(String(opts.years ?? "1"), 10) || 1;

      try {
        const { body, costUsd } = await apiFetchJson(
          auth,
          "POST",
          "/batch/analyze",
          {
            jsonBody: {
              tickers,
              metrics: ["full_metrics", "hedge_ratios"],
              years,
              format: "json",
            },
          },
        );
        printResults(body, json);
        if (!json && costUsd) console.log(chalk.dim(`Cost: $${costUsd}`));
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
      }
    });

  agent
    .command("monitor")
    .description("Latest risk snapshot for one holding: GET /metrics/{ticker}")
    .argument("<ticker>", "Symbol to poll")
    .action(async (ticker: string, _opts: unknown, cmd: Command) => {
      const json = (cmd.optsWithGlobals() as { json?: boolean }).json ?? false;
      const cfg = await loadConfig();
      const auth = requireResolvedAuth(cfg, chalk.yellow);
      if (!auth) return;

      const enc = encodeURIComponent(ticker.trim());
      try {
        const { body, costUsd } = await apiFetchJson(
          auth,
          "GET",
          `/metrics/${enc}`,
        );
        printResults(body, json);
        if (!json && costUsd) console.log(chalk.dim(`Cost: $${costUsd}`));
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
      }
    });

  agent.addHelpText(
    "after",
    `\n${chalk.dim(`More endpoints: ${DOCS} — or run \`riskmodels --help\` for the full CLI.`)}`,
  );

  return agent;
}
