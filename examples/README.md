# Examples

Runnable scripts for the RiskModels API and Python SDK. Install the SDK from the repo with `cd ../sdk && pip install -e ".[dev]"` (see [sdk/README.md](../sdk/README.md)) or `pip install riskmodels-py` from [PyPI](https://pypi.org/project/riskmodels-py/).

## Index

| Example | Language | What it shows |
|--------|----------|----------------|
| [python/quickstart.py](python/quickstart.py) | Python | Minimal `RiskModelsClient` usage |
| [python/factor_risk_table.py](python/factor_risk_table.py) | Python | Factor / risk table output |
| [python/hedge_portfolio.py](python/hedge_portfolio.py) | Python | Portfolio hedge workflow |
| [python/precision_hedge_chart.py](python/precision_hedge_chart.py) | Python | Plotting / precision hedge chart |
| [python/ai_risk_analyst.py](python/ai_risk_analyst.py) | Python | Agent-style analyst script |
| [typescript/quickstart.ts](typescript/quickstart.ts) | TypeScript | HTTP quickstart |
| [typescript/hedge_portfolio.ts](typescript/hedge_portfolio.ts) | TypeScript | Portfolio hedge (TS) |

## Docs parity

- **Core endpoints & one-liners** — [API docs (Core Endpoints)](/docs/api) (`content/docs/api.mdx`) mirrors the same flows with copyable snippets (`CopyPythonSnippet`).
- **Authentication & keys** — [/docs/authentication](/docs/authentication) and [AUTHENTICATION_GUIDE.md](../AUTHENTICATION_GUIDE.md).
- **Agent / MCP discovery** — [/docs/agent-integration](/docs/agent-integration); local MCP server lives under [`mcp/`](../mcp/).
