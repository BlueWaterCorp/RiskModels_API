import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../lib/config.js";
import { requireResolvedAuth, resolveApiAuth } from "../lib/credentials.js";
import { apiFetchJson, apiFetchOptionalAuth } from "../lib/api-client.js";
import { apiRootFromUserBase } from "../lib/api-url.js";
import { printResults } from "../lib/display.js";

export function rankingsCommand(): Command {
  const rank = new Command("rankings").description("Cross-sectional rankings (GET /rankings/...)");

  rank
    .command("snapshot")
    .description("Full or filtered ranking grid for one ticker (GET /rankings/{ticker})")
    .argument("<ticker>", "Symbol")
    .option("--metric <m>", "mkt_cap | gross_return | sector_residual | ...")
    .option("--cohort <c>", "universe | sector | subsector")
    .option("--window <w>", "1d | 21d | 63d | 252d")
    .action(
      async (
        ticker: string,
        opts: { metric?: string; cohort?: string; window?: string },
        cmd: Command,
      ) => {
        const json = (cmd.optsWithGlobals() as { json?: boolean }).json ?? false;
        const cfg = await loadConfig();
        const auth = requireResolvedAuth(cfg, chalk.yellow);
        if (!auth) return;

        const enc = encodeURIComponent(ticker.trim());
        const query: Record<string, string | undefined> = {};
        if (opts.metric) query.metric = opts.metric;
        if (opts.cohort) query.cohort = opts.cohort;
        if (opts.window) query.window = opts.window;

        try {
          const { body, costUsd } = await apiFetchJson(auth, "GET", `/rankings/${enc}`, { query });
          printResults(body, json);
          if (!json && costUsd) console.log(chalk.dim(`Cost: $${costUsd}`));
        } catch (e) {
          console.error(chalk.red(e instanceof Error ? e.message : String(e)));
          process.exitCode = 1;
        }
      },
    );

  rank
    .command("badge")
    .description("Shields.io-style badge JSON (GET /rankings/{ticker}/badge; Bearer optional)")
    .argument("<ticker>", "Symbol")
    .option("--token <t>", "When server requires RANKINGS_BADGE_TOKEN")
    .option("--metric <m>", "Ranking metric")
    .option("--cohort <c>", "universe | sector | subsector")
    .option("--window <w>", "1d | 21d | 63d | 252d")
    .action(
      async (
        ticker: string,
        opts: { token?: string; metric?: string; cohort?: string; window?: string },
        cmd: Command,
      ) => {
        const json = (cmd.optsWithGlobals() as { json?: boolean }).json ?? false;
        const cfg = await loadConfig();
        const apiRoot = apiRootFromUserBase(cfg?.apiBaseUrl);
        const auth = resolveApiAuth(cfg);

        const enc = encodeURIComponent(ticker.trim());
        const query: Record<string, string | undefined> = {};
        if (opts.token) query.token = opts.token;
        if (opts.metric) query.metric = opts.metric;
        if (opts.cohort) query.cohort = opts.cohort;
        if (opts.window) query.window = opts.window;

        try {
          const { body } = await apiFetchOptionalAuth(apiRoot, "GET", `/rankings/${enc}/badge`, {
            query,
            auth: auth ?? undefined,
          });
          printResults(body, json);
        } catch (e) {
          console.error(chalk.red(e instanceof Error ? e.message : String(e)));
          process.exitCode = 1;
        }
      },
    );

  rank
    .command("top")
    .description("Leaderboard: best names for metric × cohort × window (GET /rankings/top)")
    .requiredOption("--metric <m>", "mkt_cap | gross_return | ...")
    .requiredOption("--cohort <c>", "universe | sector | subsector")
    .requiredOption("--window <w>", "1d | 21d | 63d | 252d")
    .option("--limit <n>", "Rows (1–100)", "10")
    .action(
      async (
        opts: { metric: string; cohort: string; window: string; limit?: string },
        cmd: Command,
      ) => {
        const json = (cmd.optsWithGlobals() as { json?: boolean }).json ?? false;
        const cfg = await loadConfig();
        const auth = requireResolvedAuth(cfg, chalk.yellow);
        if (!auth) return;

        const query: Record<string, string | number | undefined> = {
          metric: opts.metric,
          cohort: opts.cohort,
          window: opts.window,
          limit: parseInt(String(opts.limit ?? "10"), 10) || 10,
        };

        try {
          const { body, costUsd } = await apiFetchJson(auth, "GET", "/rankings/top", { query });
          printResults(body, json);
          if (!json && costUsd) console.log(chalk.dim(`Cost: $${costUsd}`));
        } catch (e) {
          console.error(chalk.red(e instanceof Error ? e.message : String(e)));
          process.exitCode = 1;
        }
      },
    );

  return rank;
}
