import { access } from "node:fs/promises";
import { homedir, platform } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export type InstallClient = "claude" | "cursor" | "codex" | "vscode";

export interface ClientDetection {
  client: InstallClient;
  label: string;
  mode: "auto-write" | "command" | "guidance";
  status: "found" | "missing" | "unknown";
  configPath?: string;
  commandAvailable?: boolean;
  notes: string[];
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function commandAvailable(command: string, args = ["--version"]): boolean {
  const result = spawnSync(command, args, { stdio: "ignore" });
  return result.status === 0 || result.status === 1;
}

function claudeDesktopPath(): string {
  const home = homedir();
  const os = platform();
  if (os === "darwin") {
    return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (os === "win32") {
    return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  }
  return path.join(home, ".config", "Claude", "claude_desktop_config.json");
}

export function selectedClients(opts: { client?: string; all?: boolean }): InstallClient[] {
  if (opts.all || !opts.client) return ["claude", "cursor", "codex", "vscode"];
  const value = opts.client.toLowerCase();
  if (!["claude", "cursor", "codex", "vscode"].includes(value)) {
    throw new Error(`Unknown client: ${opts.client}. Use claude, cursor, codex, vscode, or --all.`);
  }
  return [value as InstallClient];
}

export async function detectClient(client: InstallClient, cwd = process.cwd()): Promise<ClientDetection> {
  if (client === "claude") {
    const configPath = claudeDesktopPath();
    const claudeCodeAvailable = commandAvailable("claude", ["--version"]);
    const found = (await exists(configPath)) || claudeCodeAvailable;
    return {
      client,
      label: "Claude Desktop / Claude Code",
      mode: claudeCodeAvailable ? "command" : "auto-write",
      status: found ? "found" : "missing",
      configPath,
      commandAvailable: claudeCodeAvailable,
      notes: [
        claudeCodeAvailable
          ? "Claude Code CLI detected; future safe-write flow should prefer `claude mcp add`."
          : "Claude Code CLI not detected; Claude Desktop config path is the fallback target.",
      ],
    };
  }

  if (client === "cursor") {
    const globalPath = path.join(homedir(), ".cursor", "mcp.json");
    const projectPath = path.join(cwd, ".cursor", "mcp.json");
    const globalExists = await exists(globalPath);
    const projectExists = await exists(projectPath);
    return {
      client,
      label: "Cursor",
      mode: "auto-write",
      status: globalExists || projectExists ? "found" : "missing",
      configPath: globalExists ? globalPath : projectPath,
      notes: [
        globalExists
          ? "Global Cursor MCP config exists."
          : "Workspace .cursor/mcp.json is the first dry-run target; safe writes should ask before project-scoped edits.",
      ],
    };
  }

  if (client === "codex") {
    const configPath = path.join(homedir(), ".codex", "config.toml");
    return {
      client,
      label: "Codex",
      mode: "auto-write",
      status: (await exists(configPath)) ? "found" : "missing",
      configPath,
      notes: ["Codex uses TOML config; safe-write flow must validate TOML before and after merge."],
    };
  }

  const codeAvailable = commandAvailable("code", ["--version"]);
  return {
    client,
    label: "VS Code",
    mode: "guidance",
    status: codeAvailable ? "found" : "unknown",
    commandAvailable: codeAvailable,
    notes: [
      "VS Code support is detect + guidance only in v1; no auto-write target is selected until the MCP extension/config surface is verified.",
    ],
  };
}

export async function detectClients(clients: InstallClient[], cwd = process.cwd()): Promise<ClientDetection[]> {
  return Promise.all(clients.map((client) => detectClient(client, cwd)));
}
