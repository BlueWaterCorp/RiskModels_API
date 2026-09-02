# RiskModels — Claude Code / Cowork plugin

Institutional equity risk and **PIT-normalized fundamentals derived from SEC filings and
licensed sources**, as a data layer for Claude agents. This plugin bundles the hosted
RiskModels MCP with thin skills, slash commands, an analyst agent, and a worked cookbook so
Claude can decompose a US stock or portfolio into market / sector / subsector /
stock-specific risk, produce tradeable ETF hedge ratios, pull point-in-time quarterly
fundamentals with a CAPM cost-of-capital layer, and rank names on factor and residual
risk — all from live data, with no enterprise data license.

Realized/historical data only. RiskModels is an analytical tool, **not an investment
adviser** — see [What this is not](#what-this-is-not).

**Source of truth for edits:** `RiskModels_API/claude-plugin/` (sibling monorepo). This
public repo is the installable marketplace mirror — sync with
`RiskModels_API/scripts/sync-claude-plugin.sh`.

## What you get

- **5 skills** + matching **slash commands**:
  `risk-decompose`, `fundamentals-pit`, `cost-of-capital`, `portfolio-hedge`,
  `residual-screen`.
- **An analyst agent** — `riskmodels-analyst`.
- **A [cookbook](./cookbook.md)** — fundamentals → WACC → decomposition → hedge → residual.
- **The hosted MCP** at `https://riskmodels.app/api/mcp/sse`.

## Setup

See **[plugins/riskmodels/SETUP.md](./plugins/riskmodels/SETUP.md)** for the full guide.

### Preferred (Claude Desktop / Cowork / Claude.ai) — OAuth, no key paste

**Settings → Connectors → Add custom connector** → paste
`https://riskmodels.app/api/mcp/sse` → Connect → sign in at riskmodels.app.

Then install this plugin for skills/commands/agent (one MCP connection — disable
duplicates).

### Claude Code CLI — Bearer key

```bash
export RISKMODELS_API_KEY="rm_agent_live_..."
claude plugin marketplace add BlueWaterCorp/riskmodels-plugin
claude plugin install riskmodels@riskmodels
```

Get a key: **https://riskmodels.app/get-key**.

### Slash commands

```
/risk-decompose NVDA
/fundamentals-pit AAPL
/cost-of-capital MSFT 0.05 10y
/portfolio-hedge NVDA:0.4 MSFT:0.35 XOM:0.25
/residual-screen NVDA AMD AVGO MU
```

## Already using `@riskmodels/mcp`?

The [`@riskmodels/mcp`](https://www.npmjs.com/package/@riskmodels/mcp) package is the
**raw connection**. This plugin is the **workflow layer**: same tools, plus skills,
commands, analyst agent, and cookbook. Keep **one** MCP connection.

## Skills

| Skill / command | Use it for | Wraps |
| --- | --- | --- |
| `risk-decompose` | What's driving a name's risk; L1/L2/L3 cascade + ETF hedge legs | `riskmodels_get_hedge_levels`, `riskmodels_decompose`, `get_metrics` |
| `fundamentals-pit` | Point-in-time quarterly fundamentals with `as_of` anti-look-ahead | `riskmodels_get_fundamentals` |
| `cost-of-capital` | CAPM cost of equity, WACC, economic profit; caller ERP + rf-tenor grid | `riskmodels_get_fundamentals` |
| `portfolio-hedge` | ETF hedge legs for a position or book; Lstar residual isolation | `riskmodels_hedge_portfolio`, `riskmodels_hedge_position`, `riskmodels_get_lstar` |
| `residual-screen` | Peer/universe rankings and the residual mean-reversion signal | `riskmodels_get_rankings`, `riskmodels_screen_rankings`, `riskmodels_get_residual_signal` |

## What this is not

- **Not investment advice.** Skills and the agent report model outputs — never
  recommendations, price targets, or suitability assessments. No forecasts.
- **Not a full raw-fundamentals feed.** Raw line items appear per cell only where the
  serving value is SEC XBRL (`sec_facts`); other cells are derived.
- **Not local logic.** Every number comes from a live tool call.

## License

Apache-2.0. Install glue only — configuration, prompts, and docs.
