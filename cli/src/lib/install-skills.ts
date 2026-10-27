import { spawnSync } from "node:child_process";
import type { ClientDetection, InstallClient } from "./mcp-config-paths.js";

/** Public plugin repo. `npx skills add` clones this; the npm package does not vendor the SKILL.md files. */
export const SKILLS_SOURCE = "BlueWaterCorp/riskmodels-plugin";

/**
 * skills CLI agent id for each client this installer configures.
 * Claude Desktop and Claude Code share the Claude skill directory (`claude-code`).
 * VS Code is guidance-only for MCP config; Copilot still reads `github-copilot` skills.
 */
const SKILL_AGENT: Record<InstallClient, string> = {
  claude: "claude-code",
  cursor: "cursor",
  codex: "codex",
  vscode: "github-copilot",
};

export interface SkillsInstallResult {
  skipped: boolean;
  reason?: string;
  agents: string[];
  /** argv after `npx`, for the dry-run plan and the JSON result. */
  args: string[];
  ok: boolean;
  exitCode: number | null;
  error?: string;
}

export function skillAgentsFor(detections: ClientDetection[]): string[] {
  const agents: string[] = [];
  for (const detection of detections) {
    if (detection.status !== "found") continue;
    const agent = SKILL_AGENT[detection.client];
    if (!agents.includes(agent)) agents.push(agent);
  }
  return agents;
}

/** Arguments passed to `npx`. The first `-y` is npx; the second is `skills add`. */
export function skillsAddArgs(agents: string[]): string[] {
  const args = ["-y", "skills", "add", SKILLS_SOURCE, "--skill", "*", "-g", "-y"];
  for (const agent of agents) {
    args.push("-a", agent);
  }
  return args;
}

export function planSkillsInstall(detections: ClientDetection[], skip: boolean): SkillsInstallResult {
  if (skip) {
    return { skipped: true, reason: "--no-skills", agents: [], args: [], ok: true, exitCode: null };
  }
  const agents = skillAgentsFor(detections);
  if (agents.length === 0) {
    return {
      skipped: true,
      reason: "no detected clients",
      agents: [],
      args: [],
      ok: true,
      exitCode: null,
    };
  }
  return { skipped: false, agents, args: skillsAddArgs(agents), ok: true, exitCode: null };
}

export function runSkillsInstall(plan: SkillsInstallResult, json: boolean): SkillsInstallResult {
  if (plan.skipped) return plan;
  const result = spawnSync("npx", plan.args, {
    stdio: json ? "pipe" : "inherit",
    encoding: "utf8",
    timeout: 180_000,
    env: process.env,
  });
  if (result.error) {
    return {
      ...plan,
      ok: false,
      exitCode: result.status,
      error: result.error.message,
    };
  }
  const ok = result.status === 0;
  const tail = json
    ? [result.stderr, result.stdout].filter(Boolean).join("\n").slice(-2000)
    : undefined;
  return {
    ...plan,
    ok,
    exitCode: result.status,
    ...(ok ? {} : { error: tail || `npx skills add exited ${result.status}` }),
  };
}
