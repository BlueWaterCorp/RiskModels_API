import { Command } from "commander";
import chalk from "chalk";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve path to the built MCP server entry (mcp/dist/index.js).
 *
 * Order:
 * 1. RISKMODELS_MCP_SERVER_PATH
 * 2. --mcp-server-path CLI option
 * 3. ./mcp/dist/index.js relative to cwd (repo root when running from RiskModels_API)
 * 4. ../../mcp/dist/index.js relative to cli/dist (monorepo dev: npm link / npm run from repo)
 */
export function resolveMcpServerPath(explicit?: string): string | null {
  if (process.env.RISKMODELS_MCP_SERVER_PATH?.trim()) {
    return resolve(process.env.RISKMODELS_MCP_SERVER_PATH.trim());
  }
  if (explicit?.trim()) {
    return resolve(explicit.trim());
  }
  const cwdCandidate = join(process.cwd(), "mcp", "dist", "index.js");
  if (existsSync(cwdCandidate)) {
    return cwdCandidate;
  }
  // cli/dist/commands → ../../../ = RiskModels_API repo root (sibling of cli/)
  const fromCliDist = join(__dirname, "..", "..", "..", "mcp", "dist", "index.js");
  if (existsSync(fromCliDist)) {
    return fromCliDist;
  }
  return null;
}

export function mcpServeCommand(): Command {
  return new Command("mcp")
    .description(
      "Run the RiskModels MCP server over stdio (for Claude Desktop, Cursor, etc.). Same as: node /path/to/mcp/dist/index.js",
    )
    .option(
      "-p, --mcp-server-path <path>",
      "Absolute path to mcp/dist/index.js (overrides env RISKMODELS_MCP_SERVER_PATH)",
    )
    .action((opts: { mcpServerPath?: string }) => {
      const path = resolveMcpServerPath(opts.mcpServerPath);
      if (!path) {
        console.error(
          chalk.red(
            "Could not find MCP server build at mcp/dist/index.js.\n",
          ),
        );
        console.error(
          chalk.yellow(
            "Build it:  cd mcp && npm ci && npm run build\n" +
              "Or set RISKMODELS_MCP_SERVER_PATH to the absolute path to mcp/dist/index.js\n" +
              "Or run this command from the RiskModels_API repo root after building mcp/.",
          ),
        );
        process.exitCode = 1;
        return;
      }
      const child = spawn(process.execPath, [path], {
        stdio: "inherit",
        env: { ...process.env },
      });
      child.on("exit", (code, signal) => {
        if (signal) process.exit(1);
        process.exit(code ?? 1);
      });
    });
}
