import chalk from "chalk";

/** True when `--json` appears in argv before the subcommand (parent-level flag). */
export function usedGlobalJsonBeforeSubcommand(subcommandName: string): boolean {
  const args = process.argv.slice(2);
  const jsonIdx = args.findIndex((a) => a === "--json" || a.startsWith("--json="));
  const subIdx = args.indexOf(subcommandName);
  if (jsonIdx === -1 || subIdx === -1) return false;
  return jsonIdx < subIdx;
}

/** Explains JSON output when `--json` was set before the subcommand (stderr, dim). */
export function warnIfGlobalJsonBeforeSubcommand(subcommandName: string): void {
  if (!usedGlobalJsonBeforeSubcommand(subcommandName)) return;
  console.error(
    chalk.dim(
      `Note: JSON mode is on because --json appears before "${subcommandName}". Move --json after "${subcommandName}" when you want default human output.`,
    ),
  );
}
