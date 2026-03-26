import { Command } from "commander";
import chalk from "chalk";

const DOCS = "https://riskmodels.net/docs/api";

function stub(name: string, hint: string) {
  return () => {
    console.log(
      chalk.yellow(
        `${name} is not implemented in riskmodels-cli v1.0.1.\n` +
          `Use the HTTP API, MCP server (mcp/ in the RiskModels_API repo), or Python SDK.\n` +
          `Docs: ${DOCS}\n` +
          `Hint: ${hint}`,
      ),
    );
  };
}

export function agentCommand(): Command {
  const agent = new Command("agent").description(
    "Portfolio / agent workflows (placeholders — use API or MCP for full functionality)",
  );

  agent
    .command("decompose")
    .description("L3 portfolio attribution (not implemented in CLI)")
    .option("--portfolio <file>", "Path to positions JSON (ignored)")
    .action(stub("decompose", "POST /api/batch/analyze with positions[], or use the riskmodels Python package."));

  agent
    .command("monitor")
    .description("Factor drift monitoring (not implemented in CLI)")
    .option("--portfolio <file>", "Path to positions JSON (ignored)")
    .option("--threshold <n>", "Drift threshold (ignored)")
    .action(stub("monitor", "Poll GET /api/metrics/{ticker} for holdings or integrate MCP tools."));

  return agent;
}
