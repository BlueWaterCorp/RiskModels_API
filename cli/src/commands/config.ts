import { Command } from "commander";
import inquirer from "inquirer";
import chalk from "chalk";
import {
  loadConfig,
  saveConfig,
  maskSecret,
  DEFAULT_API_BASE,
  type RiskmodelsConfig,
} from "../lib/config.js";
import { printResults } from "../lib/display.js";

export function configCommand(): Command {
  const cmd = new Command("config").description("Manage CLI configuration (~/.config/riskmodels/config.json)");

  cmd
    .command("init")
    .description("Interactive setup (billed API key or direct Supabase)")
    .action(async () => {
      const existing = await loadConfig();
      const { mode } = await inquirer.prompt<{ mode: "billed" | "direct" }>([
        {
          type: "list",
          name: "mode",
          message: "How should the CLI authenticate?",
          choices: [
            { name: "API Key (billed, recommended for production)", value: "billed" },
            { name: "Service Role Key (direct Supabase, for development)", value: "direct" },
          ],
          default: existing?.mode ?? "billed",
        },
      ]);

      if (mode === "billed") {
        const answers = await inquirer.prompt<{ apiKey: string; apiBaseUrl: string }>([
          {
            type: "password",
            name: "apiKey",
            message: "RiskModels API key (rm_agent_...)",
            mask: "*",
            validate: (v: string) => (v?.trim() ? true : "API key is required"),
          },
          {
            type: "input",
            name: "apiBaseUrl",
            message: "API base URL",
            default: existing?.apiBaseUrl ?? DEFAULT_API_BASE,
            validate: (v: string) => (v?.trim()?.startsWith("http") ? true : "Must be an https URL"),
          },
        ]);
        const cfg: RiskmodelsConfig = {
          mode: "billed",
          apiKey: answers.apiKey.trim(),
          apiBaseUrl: answers.apiBaseUrl.replace(/\/$/, ""),
        };
        await saveConfig(cfg);
        console.log(chalk.green("Saved billed mode configuration."));
      } else {
        const answers = await inquirer.prompt<{ supabaseUrl: string; serviceRoleKey: string }>([
          {
            type: "input",
            name: "supabaseUrl",
            message: "Supabase project URL",
            default: existing?.supabaseUrl ?? "",
            validate: (v: string) =>
              v?.includes("supabase.co") ? true : "URL should contain supabase.co",
          },
          {
            type: "password",
            name: "serviceRoleKey",
            message: "Supabase service role key (JWT, often starts with ey...)",
            mask: "*",
            validate: (v: string) => (v?.trim()?.startsWith("ey") ? true : "Key should start with ey"),
          },
        ]);
        const cfg: RiskmodelsConfig = {
          mode: "direct",
          supabaseUrl: answers.supabaseUrl.trim().replace(/\/$/, ""),
          serviceRoleKey: answers.serviceRoleKey.trim(),
        };
        await saveConfig(cfg);
        console.log(chalk.green("Saved direct (Supabase) configuration."));
      }
    });

  cmd
    .command("set")
    .description("Set a config value")
    .argument("<key>", "apiKey | apiBaseUrl | clientId | clientSecret | oauthScope | supabaseUrl | serviceRoleKey")
    .argument("<value>", "value to store")
    .action(async (key: string, value: string) => {
      const allowed = new Set([
        "apiKey",
        "apiBaseUrl",
        "clientId",
        "clientSecret",
        "oauthScope",
        "supabaseUrl",
        "serviceRoleKey",
      ]);
      if (!allowed.has(key)) {
        console.error(chalk.red(`Unknown key: ${key}`));
        process.exitCode = 1;
        return;
      }
      const cfg = (await loadConfig()) ?? { mode: "billed" as const };
      if (key === "apiKey") {
        cfg.mode = "billed";
        cfg.apiKey = value;
      } else if (key === "apiBaseUrl") {
        cfg.apiBaseUrl = value.replace(/\/$/, "");
      } else if (key === "clientId") {
        cfg.mode = "billed";
        cfg.clientId = value;
      } else if (key === "clientSecret") {
        cfg.mode = "billed";
        cfg.clientSecret = value;
      } else if (key === "oauthScope") {
        cfg.mode = "billed";
        cfg.oauthScope = value;
      } else if (key === "supabaseUrl") {
        cfg.mode = "direct";
        cfg.supabaseUrl = value.replace(/\/$/, "");
      } else if (key === "serviceRoleKey") {
        cfg.mode = "direct";
        cfg.serviceRoleKey = value;
      }
      await saveConfig(cfg);
      console.log(chalk.green(`Set ${key}.`));
    });

  cmd
    .command("list")
    .description("Show current configuration (secrets masked)")
    .option("--json", "JSON output")
    .action(async (opts: { json?: boolean }, cmd: Command) => {
      const json = opts.json || (cmd.optsWithGlobals() as { json?: boolean }).json;
      const cfg = await loadConfig();
      if (!cfg) {
        const empty = { mode: null, message: "No config file yet. Run: riskmodels config init" };
        printResults(empty, !!json);
        return;
      }
      const view = {
        mode: cfg.mode,
        apiBaseUrl: cfg.apiBaseUrl ?? DEFAULT_API_BASE,
        apiKey: maskSecret(cfg.apiKey),
        clientId: maskSecret(cfg.clientId),
        clientSecret: maskSecret(cfg.clientSecret),
        oauthScope: cfg.oauthScope ?? "(not set)",
        supabaseUrl: cfg.supabaseUrl ?? "(not set)",
        serviceRoleKey: maskSecret(cfg.serviceRoleKey),
      };
      printResults(view, !!json);
    });

  return cmd;
}
