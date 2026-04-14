import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../lib/config.js";
import { apiRootFromUserBase } from "../lib/api-url.js";
import { ApiHttpError, apiFetchOptionalAuth } from "../lib/api-client.js";
import { printResults } from "../lib/display.js";

/** Production health can exceed 15s when Supabase is cold; Vercel rollouts may return 502–504. */
const HEALTH_TIMEOUT_MS = 120_000;
const HEALTH_MAX_ATTEMPTS = 6;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientHealthFailure(err: unknown): boolean {
  if (err instanceof ApiHttpError) {
    return [502, 503, 504].includes(err.status);
  }
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TimeoutError") return true;
    const m = err.message.toLowerCase();
    if (m.includes("fetch failed")) return true;
    if (m.includes("econnreset") || m.includes("etimedout")) return true;
  }
  return false;
}

export function healthCommand(): Command {
  return new Command("health")
    .description(
      "Service health check (GET /api/health, no auth). Retries transient 5xx and network errors.",
    )
    .action(async (_opts, cmd: Command) => {
      const json = (cmd.optsWithGlobals() as { json?: boolean }).json ?? false;
      const cfg = await loadConfig();
      const apiRoot = apiRootFromUserBase(cfg?.apiBaseUrl);

      for (let attempt = 1; attempt <= HEALTH_MAX_ATTEMPTS; attempt += 1) {
        try {
          const { body } = await apiFetchOptionalAuth(apiRoot, "GET", "/health", {
            signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
          });
          printResults(body, json);
          return;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const retry = isTransientHealthFailure(e) && attempt < HEALTH_MAX_ATTEMPTS;
          if (retry) {
            const waitSec = 15 * attempt;
            if (!json) {
              console.error(
                chalk.yellow(
                  `Health check attempt ${attempt}/${HEALTH_MAX_ATTEMPTS} failed (${msg}); retrying in ${waitSec}s…`,
                ),
              );
            }
            await sleep(waitSec * 1000);
            continue;
          }
          console.error(chalk.red(msg));
          process.exitCode = 1;
          return;
        }
      }
    });
}
