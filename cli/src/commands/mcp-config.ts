import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, configPath } from "../lib/config.js";

type McpClient = "claude-desktop" | "cursor" | "zed";

/**
 * Default absolute path users are most likely to paste into MCP configs.
 * We don't try to introspect where the user cloned RiskModels_API — we print
 * a placeholder they can edit. Override with --mcp-server-path for precision.
 */
const DEFAULT_MCP_SERVER_PLACEHOLDER =
  "/ABSOLUTE/PATH/TO/RiskModels_API/mcp/dist/index.js";

function claudeDesktopConfig(serverPath: string, apiKey?: string) {
  const env: Record<string, string> = {};
  if (apiKey) env.RISKMODELS_API_KEY = apiKey;
  return {
    mcpServers: {
      riskmodels: {
        command: "node",
        args: [serverPath],
        ...(Object.keys(env).length ? { env } : {}),
      },
    },
  };
}

function cursorConfig(serverPath: string, apiKey?: string) {
  // Same schema shape as Claude Desktop; Cursor reads .cursor/mcp.json
  // either at workspace root or ~/.cursor/mcp.json globally.
  return claudeDesktopConfig(serverPath, apiKey);
}

function zedConfig(serverPath: string, apiKey?: string) {
  const env: Record<string, string> = {};
  if (apiKey) env.RISKMODELS_API_KEY = apiKey;
  return {
    context_servers: {
      riskmodels: {
        command: {
          path: "node",
          args: [serverPath],
          ...(Object.keys(env).length ? { env } : {}),
        },
      },
    },
  };
}

function humanPath(client: McpClient): string {
  if (client === "claude-desktop") {
    return "~/Library/Application Support/Claude/claude_desktop_config.json (macOS) or %APPDATA%\\Claude\\claude_desktop_config.json (Windows)";
  }
  if (client === "cursor") {
    return ".cursor/mcp.json (workspace) or ~/.cursor/mcp.json (global)";
  }
  return "~/.config/zed/settings.json";
}

export function mcpConfigCommand(): Command {
  return new Command("mcp-config")
    .description(
      "Print a ready-to-paste MCP client config for Claude Desktop, Cursor, or Zed",
    )
    .option(
      "-c, --client <name>",
      "claude-desktop | cursor | zed (default: claude-desktop)",
      "claude-desktop",
    )
    .option(
      "-p, --mcp-server-path <path>",
      "Absolute path to RiskModels_API/mcp/dist/index.js",
      DEFAULT_MCP_SERVER_PLACEHOLDER,
    )
    .option(
      "--embed-key",
      "Embed the API key from ~/.config/riskmodels/config.json in the env block. Default is to rely on the MCP server's fallback read of the CLI config file.",
    )
    .action(async (opts: { client?: string; mcpServerPath?: string; embedKey?: boolean }) => {
      const client = (opts.client || "claude-desktop").toLowerCase() as McpClient;
      if (!["claude-desktop", "cursor", "zed"].includes(client)) {
        console.error(
          chalk.red(
            `Unknown client: ${client}. Use claude-desktop, cursor, or zed.`,
          ),
        );
        process.exitCode = 1;
        return;
      }

      let apiKey: string | undefined;
      if (opts.embedKey) {
        const cfg = await loadConfig();
        apiKey = cfg?.apiKey?.trim();
        if (!apiKey) {
          console.error(
            chalk.yellow(
              "warning: --embed-key requested but no apiKey in " +
                configPath() +
                ". Run `riskmodels config init` first.",
            ),
          );
        }
      }

      const serverPath = opts.mcpServerPath || DEFAULT_MCP_SERVER_PLACEHOLDER;
      let config: unknown;
      if (client === "claude-desktop") config = claudeDesktopConfig(serverPath, apiKey);
      else if (client === "cursor") config = cursorConfig(serverPath, apiKey);
      else config = zedConfig(serverPath, apiKey);

      // Helpful human-readable guidance ONLY to stderr so stdout stays pipe-clean.
      console.error(chalk.dim(`# Paste this into ${humanPath(client)}`));
      if (!opts.embedKey) {
        console.error(
          chalk.dim(
            `# The MCP server reads ~/.config/riskmodels/config.json automatically — no key needed in the env block.`,
          ),
        );
      }
      if (serverPath === DEFAULT_MCP_SERVER_PLACEHOLDER) {
        console.error(
          chalk.dim(
            `# Replace the placeholder path with the absolute path to your RiskModels_API/mcp/dist/index.js.`,
          ),
        );
      }
      console.log(JSON.stringify(config, null, 2));
    });
}
