import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../lib/config.js";
import { requireResolvedAuth } from "../lib/credentials.js";
import { apiFetchJson } from "../lib/api-client.js";
import { printResults } from "../lib/display.js";

export function decomposeCommand(): Command {
  return new Command("decompose")
    .description(
      "Four-layer decomposition + hedge map for one ticker (POST /decompose)",
    )
    .argument("<ticker>", "Ticker symbol, e.g. NVDA")
    .action(async (ticker: string, _opts: unknown, cmd: Command) => {
      const json = (cmd.optsWithGlobals() as { json?: boolean }).json ?? false;
      const cfg = await loadConfig();
      const auth = requireResolvedAuth(cfg, chalk.yellow);
      if (!auth) return;
      const t = ticker.trim();
      try {
        const { body, costUsd } = await apiFetchJson(auth, "POST", "/decompose", {
          jsonBody: { ticker: t },
        });
        printResults(body, json);
        if (!json && costUsd) console.log(chalk.dim(`Cost: $${costUsd}`));
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
      }
    });
}
