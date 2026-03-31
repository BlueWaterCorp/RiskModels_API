#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { configCommand } from "./commands/config.js";
import { queryCommand } from "./commands/query.js";
import { schemaCommand } from "./commands/schema.js";
import { balanceCommand } from "./commands/balance.js";
import { manifestCommand } from "./commands/manifest.js";
import { agentCommand } from "./commands/agent.js";
import { metricsCommand } from "./commands/metrics.js";
import { batchCommand } from "./commands/batch.js";
import { portfolioCommand } from "./commands/portfolio.js";
import { tickersCommand } from "./commands/tickers.js";
import { healthCommand } from "./commands/health.js";
import { estimateCommand } from "./commands/estimate.js";
import { returnsCommand } from "./commands/returns.js";
import { l3Command } from "./commands/l3.js";
import { correlationCommand } from "./commands/correlation.js";
import { rankingsCommand } from "./commands/rankings.js";

const program = new Command();

program
  .name("riskmodels")
  .description("RiskModels CLI — REST API, SQL query, schema, billing, and agent manifests")
  .version("2.0.0", "-V, --version", "output version")
  .option("--json", "JSON output for supported commands (query, schema, balance, API calls, config list)")
  .configureHelp({ sortSubcommands: true })
  .addHelpText(
    "after",
    `
${chalk.bold("Quick start")}
  ${chalk.dim("$")} riskmodels config init
  ${chalk.dim("$")} riskmodels health
  ${chalk.dim("$")} riskmodels metrics NVDA
  ${chalk.dim("$")} riskmodels query ${chalk.green('"SELECT ticker FROM ticker_metadata LIMIT 3"')}
  ${chalk.dim("$")} riskmodels manifest --format anthropic

${chalk.bold("Docs")} https://riskmodels.net/docs/api`,
  );

program.addCommand(configCommand());
program.addCommand(queryCommand());
program.addCommand(metricsCommand());
program.addCommand(batchCommand());
program.addCommand(portfolioCommand());
program.addCommand(returnsCommand());
program.addCommand(l3Command());
program.addCommand(correlationCommand());
program.addCommand(rankingsCommand());
program.addCommand(tickersCommand());
program.addCommand(healthCommand());
program.addCommand(estimateCommand());
program.addCommand(schemaCommand());
program.addCommand(balanceCommand());
program.addCommand(manifestCommand());
program.addCommand(agentCommand());

await program.parseAsync(process.argv);
