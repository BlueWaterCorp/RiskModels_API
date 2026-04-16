# RiskModels MCP — Client Install Guide

Copy-paste configs for Claude Desktop, Cursor, and Zed. Works with any [MCP](https://modelcontextprotocol.io) client that supports stdio servers.

## Prerequisites (one time)

```bash
# 1. Get an API key (Stripe card on file, $20 free credit before first charge)
npm install -g riskmodels-cli
riskmodels config init      # stores key at ~/.config/riskmodels/config.json

# 2. Build the MCP server (from this repo)
cd RiskModels_API/mcp
npm install && npm run build
```

The MCP server reads your API key from `~/.config/riskmodels/config.json` automatically — no need to embed the key in every MCP client config.

Replace `/ABSOLUTE/PATH/TO/RiskModels_API` below with the actual absolute path to your clone of this repo.

---

## Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "riskmodels": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/RiskModels_API/mcp/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop. In a new conversation you should see the RiskModels tools listed — try "Run `get_l3_decomposition` for NVDA."

---

## Cursor

This repo ships `.cursor/mcp.json` pointing at the built server, so opening `RiskModels_API/` as a workspace folder auto-wires it. For a different layout, edit `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "riskmodels-api": {
      "command": "node",
      "args": ["mcp/dist/index.js"]
    }
  }
}
```

Use absolute paths if Cursor's workspace root is not `RiskModels_API/`. Reload MCP (Settings → MCP → Reload) after saving.

---

## Zed

Edit `~/.config/zed/settings.json`:

```json
{
  "context_servers": {
    "riskmodels": {
      "command": {
        "path": "node",
        "args": ["/ABSOLUTE/PATH/TO/RiskModels_API/mcp/dist/index.js"]
      }
    }
  }
}
```

Restart Zed. Use the assistant panel with `@riskmodels` to call tools.

---

## Overriding the API key per-client (optional)

If you want a different key for a specific MCP client (e.g., a scoped `rm_agent_mcp_*` key for Claude Desktop, a broader key for Cursor), set `RISKMODELS_API_KEY` in that client's MCP env block. Env takes precedence over the CLI config file:

```json
{
  "mcpServers": {
    "riskmodels": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/RiskModels_API/mcp/dist/index.js"],
      "env": {
        "RISKMODELS_API_KEY": "rm_agent_...",
        "RISKMODELS_API_BASE": "https://riskmodels.app"
      }
    }
  }
}
```

---

## Verifying the install

Once the server is wired up, ask the assistant:

> "List all RiskModels tools."

You should see:

- **Discovery** — `riskmodels_list_endpoints`, `riskmodels_get_capability`, `riskmodels_get_schema`
- **Data** — `get_metrics`, `get_l3_decomposition`, `get_portfolio_risk_snapshot`

Then:

> "Get the L3 decomposition for NVDA with 1 year of history."

Every data-tool response includes a meter envelope (`_cost_usd`, `_remaining_daily_usd`, `_rate_limit_remaining`, `_data_as_of`) so the agent can see the meter running and self-throttle.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Tools don't appear | Fully quit and relaunch the client (not just reload). Stdio servers spawn at client start. |
| `RISKMODELS_API_KEY not found` in tool response | Run `riskmodels config init` or set the env var in the MCP client config. |
| `API 401` in tool response | Key is invalid or revoked. `riskmodels config init` to mint a fresh one. |
| `API 429` in tool response | Hit the per-minute rate limit. Default is 60/min; scoped MCP keys are tighter. Wait or ask an admin to bump. |
| `get_l3_decomposition` returns `Symbol not found` | Ticker is not in the RiskModels universe. Try `riskmodels_get_capability { id: "tickers" }` for the universe endpoint. |
