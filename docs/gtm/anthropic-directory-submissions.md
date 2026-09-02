# Anthropic directory submissions — RiskModels

**Date:** 2026-09-02 · **Backlog:** E.24 (Connectors) · E.30 (plugin packaging)  
**Status:** Code ready for CEO/ops submit. Do **not** wait on [financial-services#289](https://github.com/anthropics/financial-services/pull/289).

Two separate Anthropic products. Submit both.

---

## 1. Claude plugin directory (skills / Cowork / Claude Code)

| Field | Value |
| --- | --- |
| Form | https://platform.claude.com/plugins/submit (or claude.ai Team/Enterprise Directory) |
| Public GitHub URL | **https://github.com/BlueWaterCorp/riskmodels-plugin** |
| Marketplace name | `riskmodels` |
| Plugin id | `riskmodels@riskmodels` |
| Version | `0.2.0` |
| Tagline (≤55 chars) | Equity risk, PIT fundamentals, ETF hedges via MCP |
| Description | L1/L2/L3 equity risk decomposition with tradeable hedge ratios, residual (Lstar) signal, cross-sectional rankings, and point-in-time quarterly fundamentals with a CAPM cost-of-capital layer. Wraps the hosted RiskModels MCP at riskmodels.app. Realized/historical data only; not investment advice. |
| Categories | finance, analytics |
| Homepage | https://riskmodels.app |
| Docs | https://riskmodels.app/docs/agent-integration |
| Privacy | https://riskmodels.app/privacy → https://riskmodels.net/privacy |
| License | Apache-2.0 |
| Validate (local) | `claude plugin validate` on `plugins/riskmodels` and marketplace root — **passed 2026-09-02** |

Install smoke (already verified locally):

```bash
claude plugin marketplace add BlueWaterCorp/riskmodels-plugin
claude plugin install riskmodels@riskmodels
```

SSOT edits: `RiskModels_API/claude-plugin/`. Publish: `scripts/sync-claude-plugin.sh` then push `riskmodels-plugin`.

---

## 2. Connectors directory (hosted MCP — E.24)

| Field | Value |
| --- | --- |
| Portal | Claude.ai → Organization settings → Directory (Team/Enterprise Owner) |
| Server URL | **https://riskmodels.app/api/mcp/sse** |
| Transport | Streamable HTTP (SSE path; clients use Streamable HTTP) |
| Auth | **OAuth with DCR** (`POST /api/oauth/register`, PKCE S256) — E.20 complete |
| Docs | https://riskmodels.app/docs/agent-integration |
| Privacy | https://riskmodels.app/privacy (or https://riskmodels.net/privacy) |
| Support | support contact = CEO / ops email used on OpenBB listing |
| Icon | Same square as OpenBB listing (`Logos/RiskModels_Square` / openbb listing assets) |
| Categories | finance / analytics |
| Escalation | mcp-review@anthropic.com |

### Pre-submit checklist

- [x] Tool `title` + `readOnlyHint` on hosted MCP tools (audited 2026-09-02 — no missing titles)
- [x] OAuth AS + protected-resource well-knowns live (`/.well-known/oauth-authorization-server` 200)
- [x] Custom connector path CEO-verified historically (E.20)
- [x] `/privacy` on `.app` redirects to `.net` (next.config — deploy with this change)
- [ ] CEO: Team/Enterprise org + Directory permission
- [ ] CEO: populated reviewer account (MAG7 or paid key) + Connect → tools load
- [ ] CEO: submit + track dashboard; close E.24 when listed

### Listing copy (portal)

- **Name:** RiskModels  
- **Tagline:** Factor risk, ETF hedges, PIT fundamentals for US equities  
- **Description:** Hosted MCP for ERM3 L1/L2/L3 variance decomposition, tradeable ETF hedge ratios, portfolio hedges, rankings, and point-in-time quarterly fundamentals with a CAPM cost-of-capital layer. Free connect; metered per call. Realized/historical analytics only — not investment advice.  
- **Primary use cases:** Equity risk decomposition; hedge construction; PIT fundamentals / WACC; residual screening  
- **Data handling:** First-party API (riskmodels.app); no PHI  

---

## CEO actions (cannot be done from agent session)

1. ~~Push `BlueWaterCorp/riskmodels-plugin`~~ — done 2026-09-02 (`75739e1` v0.2.0 on `main`).
2. Submit plugin GitHub URL to plugin directory.
3. Submit MCP URL to Connectors directory with OAuth DCR.
4. Deploy RiskModels_API so live `/privacy` redirect + `/llms.txt` plugin block ship.
5. Update `MASTER_BACKLOG.md` E.24 when dashboard shows submitted/listed.
