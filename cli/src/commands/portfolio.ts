import { readFile } from "node:fs/promises";
import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../lib/config.js";
import { requireResolvedAuth } from "../lib/credentials.js";
import { apiFetchJson } from "../lib/api-client.js";
import { printResults } from "../lib/display.js";

export function portfolioCommand(): Command {
  const portfolio = new Command("portfolio").description("Portfolio-level API (POST /portfolio/risk-index)");

  portfolio
    .command("risk-index")
    .description("Holdings-weighted L3 variance decomposition and optional ER time series")
    .option("--file <path>", "JSON file: { positions: [{ ticker, weight }, ...] }")
    .option("--stdin", "Read positions JSON from stdin")
    .option("--time-series", "Include daily portfolio ER time series")
    .option("--years <n>", "Years when --time-series (1–15)", "1")
    .action(
      async (
        opts: { file?: string; stdin?: boolean; timeSeries?: boolean; years?: string },
        cmd: Command,
      ) => {
        const json = (cmd.optsWithGlobals() as { json?: boolean }).json ?? false;
        const cfg = await loadConfig();
        const auth = requireResolvedAuth(cfg, chalk.yellow);
        if (!auth) return;

        let raw: string;
        try {
          if (opts.stdin) {
            raw = await readStdin();
          } else if (opts.file) {
            raw = await readFile(opts.file, "utf8");
          } else {
            console.error(chalk.red("Provide --file <path> or --stdin with JSON body."));
            process.exitCode = 1;
            return;
          }
        } catch (e) {
          console.error(chalk.red(e instanceof Error ? e.message : String(e)));
          process.exitCode = 1;
          return;
        }

        let bodyIn: { positions?: unknown[]; timeSeries?: boolean; years?: number };
        try {
          bodyIn = JSON.parse(raw) as typeof bodyIn;
        } catch {
          console.error(chalk.red("Invalid JSON."));
          process.exitCode = 1;
          return;
        }

        const positions = bodyIn.positions;
        if (!Array.isArray(positions)) {
          console.error(chalk.red('JSON must include a "positions" array: { ticker, weight }.'));
          process.exitCode = 1;
          return;
        }

        const years = parseInt(String(opts.years ?? bodyIn.years ?? "1"), 10) || 1;
        const timeSeries = opts.timeSeries ?? bodyIn.timeSeries ?? false;

        try {
          const { body, costUsd } = await apiFetchJson(auth, "POST", "/portfolio/risk-index", {
            jsonBody: { positions, timeSeries, years },
          });
          printResults(body, json);
          if (!json && costUsd) console.log(chalk.dim(`Cost: $${costUsd}`));
        } catch (e) {
          console.error(chalk.red(e instanceof Error ? e.message : String(e)));
          process.exitCode = 1;
        }
      },
    );

  return portfolio;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
