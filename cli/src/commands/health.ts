import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../lib/config.js";
import { apiRootFromUserBase } from "../lib/api-url.js";
import { apiFetchOptionalAuth } from "../lib/api-client.js";
import { printResults } from "../lib/display.js";

export function healthCommand(): Command {
  return new Command("health")
    .description("Service health check (GET /health, no auth)")
    .action(async (_opts, cmd: Command) => {
      const json = (cmd.optsWithGlobals() as { json?: boolean }).json ?? false;
      const cfg = await loadConfig();
      const apiRoot = apiRootFromUserBase(cfg?.apiBaseUrl);

      try {
        const { body } = await apiFetchOptionalAuth(apiRoot, "GET", "/health");
        printResults(body, json);
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
      }
    });
}
