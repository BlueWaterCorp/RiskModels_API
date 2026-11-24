/**
 * First-call examples shown on the home page, the quickstart and the key page.
 * Each was run against production on EXECUTED_ON with a live key; change one
 * only together with a fresh run.
 */
export const EXECUTED_ON = '2026-11-24';

/** Minimum Python SDK version quoted anywhere on the site or in email. One place. */
export const SDK_MIN_VERSION = '0.5.1';
export const SDK_PIP_SPEC = `riskmodels-py>=${SDK_MIN_VERSION}`;

export const CURL_FIRST_CALL = `curl https://riskmodels.app/api/metrics/NVDA \\
  -H "Authorization: Bearer $RISKMODELS_API_KEY"`;

export const PYTHON_INSTALL = `python3 -m pip install "${SDK_PIP_SPEC}"   # Python 3.10+
export RISKMODELS_API_KEY=rm_agent_...`;

export const PYTHON_FIRST_CALL = `from riskmodels import RiskModelsClient

client = RiskModelsClient.from_env()   # reads RISKMODELS_API_KEY
row = client.get_metrics("NVDA")
print(row["l3_residual_er"], row["l3_market_hr"])`;

/** Printed by PYTHON_FIRST_CALL on EXECUTED_ON (data date 2026-11-23). */
export const PYTHON_FIRST_CALL_OUTPUT = '0.479763239622116 -0.620746552944183';

export const CLI_INSTALL = `npm install -g riskmodels@latest
export RISKMODELS_API_KEY=rm_agent_...
riskmodels doctor`;

export const CLI_FIRST_CALL = 'riskmodels decompose NVDA';

export const AGENT_INSTALL = `RISKMODELS_API_KEY=rm_agent_... npx -y riskmodels@latest install --dry-run
# prints the planned changes; rerun without --dry-run to write them`;
