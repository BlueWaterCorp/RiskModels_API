import { Command } from "commander";
import chalk from "chalk";
import { createClient } from "@supabase/supabase-js";
import ora from "ora";
import { loadConfig, isDirectReady, needsConfigMessage, needsApiKeyMessage } from "../lib/config.js";
import { resolveApiAuth } from "../lib/credentials.js";
import { apiFetchJson } from "../lib/api-client.js";
import { validateQuery, ensureLimitClause } from "../lib/sql-validation.js";
import { printResults } from "../lib/display.js";

async function runBilledQuery(
  auth: NonNullable<ReturnType<typeof resolveApiAuth>>,
  sql: string,
  limit: number,
): Promise<{ body: unknown; costUsd?: string }> {
  const finalSql = ensureLimitClause(sql, limit);
  const { body, costUsd } = await apiFetchJson(auth, "POST", "/cli/query", {
    jsonBody: { sql: finalSql, limit },
  });
  return { body, costUsd };
}

async function runDirectQuery(supabaseUrl: string, serviceKey: string, sql: string, limit: number): Promise<unknown> {
  const validation = validateQuery(sql);
  if (!validation.valid) {
    throw new Error(validation.error);
  }
  const finalSql = ensureLimitClause(validation.sanitized, limit);
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("exec_sql", { query: finalSql });
  if (error) {
    throw new Error(error.message);
  }
  return { results: data ?? [], count: Array.isArray(data) ? data.length : 0, sql: finalSql };
}

export function queryCommand(): Command {
  return new Command("query")
    .description("Run a read-only SQL query (billed: HTTP API, direct: Supabase exec_sql)")
    .argument("<sql>", "SELECT statement")
    .option("-l, --limit <n>", "Max rows when query has no LIMIT", "100")
    .action(async (sqlArg: string, opts: { limit?: string }, cmd: Command) => {
      const json = (cmd.optsWithGlobals() as { json?: boolean }).json ?? false;
      const limit = parseInt(String(opts.limit ?? "100"), 10) || 100;
      const cfg = await loadConfig();

      if (!isDirectReady(cfg) && !resolveApiAuth(cfg)) {
        if (cfg?.mode === "direct") {
          console.error(chalk.yellow(needsConfigMessage()));
        } else {
          console.error(chalk.yellow(needsApiKeyMessage()));
        }
        process.exitCode = 1;
        return;
      }

      const validation = validateQuery(sqlArg);
      if (!validation.valid) {
        console.error(chalk.red(validation.error));
        process.exitCode = 1;
        return;
      }

      const auth = resolveApiAuth(cfg);
      if (auth && !isDirectReady(cfg)) {
        const spinner = json ? null : ora("Running query…").start();
        try {
          const { body, costUsd } = await runBilledQuery(auth, validation.sanitized, limit);
          spinner?.succeed("Done");
          printResults(body, json);
          if (!json && costUsd) {
            console.log(chalk.dim(`Cost: $${costUsd}`));
          }
        } catch (e) {
          spinner?.fail("Query failed");
          console.error(chalk.red(e instanceof Error ? e.message : String(e)));
          process.exitCode = 1;
        }
        return;
      }

      if (isDirectReady(cfg)) {
        const spinner = json ? null : ora("Running query…").start();
        try {
          const body = await runDirectQuery(cfg!.supabaseUrl!, cfg!.serviceRoleKey!, validation.sanitized, limit);
          spinner?.succeed("Done");
          printResults(body, json);
        } catch (e) {
          spinner?.fail("Query failed");
          console.error(chalk.red(e instanceof Error ? e.message : String(e)));
          process.exitCode = 1;
        }
        return;
      }
    });
}
