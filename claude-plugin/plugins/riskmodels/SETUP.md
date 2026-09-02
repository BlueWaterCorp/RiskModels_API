# SETUP — connect RiskModels

This plugin wraps the **hosted** RiskModels MCP at
`https://riskmodels.app/api/mcp/sse`. Install is free; calls bill per underlying
REST route. Realized/historical analytics only — not investment advice.

## Preferred: OAuth connect-by-URL (Claude Desktop / Cowork / Claude.ai)

No API key paste. Claude opens a browser sign-in once.

1. **Settings → Connectors → Add custom connector** (wording may vary by client).
2. Paste: `https://riskmodels.app/api/mcp/sse`
3. Leave OAuth Client ID / Secret blank.
4. **Add → Connect**, then sign in at riskmodels.app (OAuth 2.0 + PKCE + DCR).
5. After Connect, paste this first message (do **not** start with `list_endpoints`):

   > Compare AAPL and NVDA with riskmodels_compare and riskmodels_decompose. Quote
   > residual explained-risk and the L3 hedge ratios from the tool JSON. Do not
   > answer from training data.

If this plugin's bundled MCP is also enabled, you may see a duplicate server —
disable one. One connection is enough.

## Claude Code CLI fallback: Bearer API key

Claude Code plugins have no OAuth prompt today. Set a key **before** install:

```bash
export RISKMODELS_API_KEY="rm_agent_live_..."
```

Get a key (free tier; usage billed per call): https://riskmodels.app/get-key

Then:

```bash
claude plugin marketplace add BlueWaterCorp/riskmodels-plugin
claude plugin install riskmodels@riskmodels
```

The plugin's `mcpServers` entry sends `Authorization: Bearer ${RISKMODELS_API_KEY}`.

### Marketplace source mismatch

If `marketplace add` fails with *network source differs from the one declared…*, this
machine already registered marketplace name `riskmodels` from a **local path** (dev
smoke) or another Git URL. Reset to the public repo:

```bash
claude plugin marketplace remove riskmodels
claude plugin marketplace add BlueWaterCorp/riskmodels-plugin
claude plugin install riskmodels@riskmodels
```

Keep the local path only while iterating on `RiskModels_API/claude-plugin/` before sync.

## Already connected via `@riskmodels/mcp` or a custom connector?

Keep **one** MCP connection. Install this plugin for skills / commands / the
analyst agent, and skip or disable the duplicate MCP entry.

## Slash commands (after install)

```
/risk-decompose NVDA
/fundamentals-pit AAPL
/cost-of-capital MSFT 0.05 10y
/portfolio-hedge NVDA:0.4 MSFT:0.35
/residual-screen NVDA AMD AVGO
```

Or ask the `riskmodels-analyst` agent in plain English.

## Docs

- Agent integration: https://riskmodels.app/docs/agent-integration
- Discovery: https://riskmodels.app/llms.txt
- MCP manifest: https://riskmodels.app/.well-known/mcp.json
- Privacy: https://riskmodels.net/privacy
