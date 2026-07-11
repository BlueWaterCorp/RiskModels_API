# OpenBB Workspace adapter (E.21)

A thin translation layer that exposes the RiskModels public API as an
[OpenBB Workspace custom backend](https://docs.openbb.co/workspace/developers/data-integration).
It serves `widgets.json` + `apps.json` and per-widget endpoints that reshape
`/api/*` responses into OpenBB table/chart/metric/HTML formats.

## Design

- **Pure translation layer.** No engine access. Each widget calls the same
  public REST API an external consumer would (`_lib/upstream.ts`), so billing,
  rate limits, and entitlements are identical to a direct API call.
- **Per-user auth passthrough.** The OpenBB user pastes their own
  `rm_agent_live_*` key into the Workspace "Add data" auth UI as an
  `X-API-KEY` header. The adapter forwards it as a Bearer token. No shared
  secret; each user is billed against their own key.
- **Scoped CORS.** `_lib/cors.ts` allows only the OpenBB origins (and the
  `X-API-KEY` header) — kept separate from the shared `@/lib/cors`.
- **No mock data.** `widgets.json` lists only widgets whose data endpoint is
  wired. Missing upstream fields render as `—`, never fabricated.

## Connect in OpenBB Workspace

1. `pro.openbb.co` → right-click a dashboard → **Add data** → **Custom backend**.
2. Base URL: `https://riskmodels.app/openbb`
   (subdomain `openbb.riskmodels.app` maps here via a Vercel domain rewrite).
   Widget `endpoint` paths in `widgets.json` are **relative to this base** (e.g.
   `widgets/metrics`, not `openbb/widgets/metrics`).
3. Add header `X-API-KEY` = your `rm_agent_live_*` key.

## Local test

```bash
npm run dev   # http://localhost:3000
curl http://localhost:3000/openbb/widgets.json | jq
curl "http://localhost:3000/openbb/widgets/metrics?ticker=AAPL" \
  -H "X-API-KEY: rm_agent_live_..." | jq
```

## Endpoint layout

| Path | Purpose | Status |
|------|---------|--------|
| `GET /openbb` | Backend info | ✅ |
| `GET /openbb/widgets.json` | Widget defs | ✅ |
| `GET /openbb/apps.json` | App defs | ✅ |
| `GET /openbb/agents.json` | AI agent discovery — registers **RiskModels Analyst** | ✅ live |
| `POST /openbb/query` | AI agent endpoint (SSE) — proxies to `/api/chat` (Claude + risk tools) | ✅ live |
| `GET /openbb/prompts.json` | Prompt defs (empty stub) | ✅ |
| `GET /openbb/widgets/metrics?ticker=` | Single-name risk table | ✅ live |
| `GET /openbb/widgets/snapshot-table?ticker=` | Risk snapshot as a table (L3 decomposition + hedge ratios) | ✅ live |
| `GET /openbb/widgets/snapshot?ticker=` | Risk-snapshot PDF, legacy `pdf` widget type (kept for API; **not** registered as a widget — OpenBB's pdf.js viewer wouldn't render it, #194) | ⚠️ deprecated as widget |
| `GET /openbb/widgets/tearsheet?ticker=&file=` | Risk-snapshot PDF via `multi_file_viewer` (retry of the above) | ✅ live |
| `GET /openbb/widgets/tearsheet-options?ticker=` | fileSelector options for the tearsheet widget | ✅ live |
| `GET /openbb/widgets/returns-chart?ticker=&years=` | Cumulative total-return line chart | ✅ live |
| `GET /openbb/widgets/risk-composition?ticker=&years=` | L3 explained-risk over time (line chart) | ✅ live |
| `GET /openbb/widgets/rankings-top?metric=&cohort=&window=&limit=` | Top-ranked names table | ✅ live |
| `GET /openbb/widgets/rankings?ticker=` | Single-name rankings table | ✅ live |
| `GET /openbb/widgets/etf-factor-returns?sleeve=` | Factor-ETF trailing returns (bar chart) | ✅ live |
| `GET /openbb/widgets/etf-holdings?ticker=&top=` | ETF top-N holdings table | ✅ live |
| `GET /openbb/widgets/filer-holdings?bw_filer_id=&limit=` | 13F filer top-N holdings table | ✅ live |
| `GET /openbb/widgets/universe-members?universe=&teo=` | Named-universe active membership table | ✅ live |
| `GET /openbb/widgets/fundamentals-history?ticker=&periods=&as_of=` | PIT quarterly fundamentals table (sec_facts raw columns + derived TTM ratios) | ✅ live |
| `GET /openbb/widgets/fundamentals-ratios?ticker=&periods=&as_of=` | TTM capital-return ratios (line chart) | ✅ live |
| `GET /openbb/widgets/cost-of-capital?ticker=&erp=&rf_tenor=&tax_rate=` | Latest-quarter cost of capital metric table | ✅ live |
| `GET /openbb/widgets/wacc-grid?ticker=&measure=&tax_rate=` | ERP × rf-tenor sensitivity grid table | ✅ live |

Chart widgets use OpenBB's built-in table `chartView` (`data.table.chartView`,
`chartType: "line"` or `"bar"`) — the endpoint returns plain row arrays, so
they render as a chart and degrade to a readable table. `etf-factor-returns`
is a one-teo cross-sectional snapshot (not a time series), so it renders as a
grouped bar across tickers rather than a line. `rankings/screen` is
intentionally skipped (POST-only upstream; OpenBB widgets fetch via GET).

## Widget roadmap (add one route per item, then list it in `widgets.json`)

- **Charts** → `/correlation`, `/macro-factors`, `/returns-decomposition`
  (`/ticker-returns` + `/l3-decomposition` covered by returns-chart /
  risk-composition; `/etf/factor-returns` now covered by etf-factor-returns)
- **Tables** → `/universe/{name}/members`, `/etf-holdings`, `/filer-holdings`
  (all three now covered — see live table above)
- **HTML / image** → multi-position portfolio tearsheet, MCP `render_artifact`
  PNGs. (Single-name `snapshot.pdf` is now live above via the `tearsheet`
  `multi_file_viewer` widget. `snapshot.png` needs `PLAYWRIGHT_PDF_ENABLED=true`
  upstream — prefer the PDF route, which is pure server-side.)
- **Portfolio** → `/portfolio/risk-snapshot` + L1/L2/L3 hedge layering
- **Apps** → flagship **"RiskModels"** app (the ONE listable marketplace
  unit — Overview · Fundamentals · Portfolio · Screener · Tearsheet in one
  app) + the original three focused apps (Single-Name Risk · Portfolio Risk
  & Hedge · Screener), all with cover images (`public/openbb-assets/`),
  `selected_agent`, and `prompts` (`@[id:WIDGET_ID]` mentions) for the
  RiskModels Analyst copilot. `agents.json` declares
  `widget-dashboard-select` / `widget-dashboard-search` so Workspace sends
  pinned-widget context to `/openbb/query` (without them the panel shows
  "Context not available for this copilot"). Optional follow-up: add
  ConnectTrade's remote MCP server under an app's `mcp_servers` once its
  remote-MCP endpoint is confirmed.
- **Fundamentals (E.23 g)** → `fundamentals-history`, `fundamentals-ratios`,
  `cost-of-capital`, and `wacc-grid` widgets over `GET /api/fundamentals`
  (PIT, per-cell `sec_facts` provenance, caller-supplied ERP), a
  "Fundamentals" tab in the Single-Name Risk app, and a `get_fundamentals`
  chat tool so the copilot reads the same surface. Earnings-surprise /
  beat-streak widgets are deliberately absent: the fundamentals contract
  holds back `eps_estimate`/`eps_actual`/`earnings_surprise` (licensing
  allowlist), so there is no served field to render.
- **Widget polish** → `refetchInterval` on live/intraday widgets (60s for
  single-name metrics/snapshot, portfolio risk/positions, and the ETF
  factor-returns snapshot; 5min for rankings — holdings/universe/filer/
  tearsheet widgets are left unset since their underlying data changes at
  most daily). `colorRules` (green/red) on signed return columns
  (`etf-factor-returns`, `cumulative-return` around its 100 baseline).
  Sparklines are skipped for now — they need a per-row historical-array cell,
  and no live endpoint returns that shape yet without a new upstream
  aggregation; revisit if/when one does.

## Key→portfolio bridge (B.6)

`rm_portfolio_risk` / `rm_portfolio_positions` take a `source` param
(`manual` default, or `synced`). `source=synced` calls
`_lib/portfolio.ts#fetchSyncedPositions`, which hits **`GET
{RISKMODELS_NET_URL}/api/positions`** (the Risk_Models portal, default
`https://riskmodels.net`) with the same `X-API-KEY`/Bearer the OpenBB user
supplied here, and maps the response into the same `Position[]` shape
`fetchPortfolioSnapshot` already expects. No new state on this side — the
positions still live only in the portal's Supabase (KMS-encrypted;
ConnectTrade/Plaid sync writes them, ordinary reads never see plaintext at
rest).

This works because RiskModels_API and the portal share one Supabase project
and API-key table (`agent_api_keys` / `user_generated_api_keys`) — a key
issued by either side resolves to the same `user_id`. Both repos hash keys as
`SHA-256(key + salt)` reading `API_KEY_SALT`/`API_KEY_SECRET`, which must hold
the *same value* in both deployments' env config for a key to validate on
both sides (locally this only works via `doppler run`, since `API_KEY_SECRET`
isn't in the checked-in `.env.local` — Doppler-managed).

**Live-verified 2026-07-08** end to end against a real Schwab-connected
ConnectTrade account: `source=synced` correctly returned real weight/L3-ER/
hedge-ratio rows for ERM3-covered equities, `—` for ETF holdings (outside the
single-name L3 model, same as `risk-composition`), and a short position
(`weight < 0`) surfaced as `"excluded (short)"` per position rather than
silently dropped (`/portfolio/risk-snapshot`'s `PortfolioRiskSnapshotRequestSchema`
requires `weight.positive()`, so shorts can't be passed through as-is).

Deliberately did **not** build: RiskModels_API reading `user_positions`
directly (it's KMS-envelope-encrypted — decrypting requires the portal's GCP
KMS calls, which would mean duplicating that crypto subsystem here — a much
bigger, riskier lift than one portal-side GET route), or push-syncing
positions into a second store on this side (pure duplication given the
already-shared Supabase).

## AI agent (RiskModels Analyst)

`agents.json` registers one agent; `POST /openbb/query` is its endpoint. It's a
thin adapter — it maps OpenBB's `QueryRequest` messages to our chat format and
proxies to `POST /api/chat` (Claude + the RiskModels tool suite), forwarding the
OpenBB user's `X-API-KEY` as a Bearer token. Auth, billing, entitlements, and
the analyst doctrine are reused from `/api/chat` unchanged.

**Add it in OpenBB:** copilot icon → **+** → base URL `https://riskmodels.app/openbb`
(Workspace fetches `agents.json`, uses `/openbb/query` for chat).

**Streaming/citations (B.7, done within adapter scope):**
- `copilotMessageChunk`: the final answer paced out word-by-word (not true
  token-level LLM streaming — `/api/chat`'s tool loop is a single blocking
  call with no SSE mode of its own, and it's shared with the main portal chat,
  so adding real streaming there is a core-engine change, not an adapter one.
  Tracked as a follow-up below).
- `copilotStatusUpdate`: one reasoning-step line per tool the analyst actually
  called (from `tool_calls_summary`), not a single combined line.
- `copilotCitationCollection`: built only when the request's `context` (the
  user's pinned dashboard data) matches an entry in `widgets` — cites the real
  widget, never fabricated.
- `context`/`widgets` from `QueryRequest`: pinned dashboard context is
  summarized and prepended to the user's question before it reaches
  `/api/chat`, so the analyst can see what's on screen.

Follow-up: real token-level streaming requires `/api/chat` (`lib/chat/
agent-runner.ts`) to grow its own SSE/streaming mode — evaluate alongside any
portal chat streaming work, since the two share that backend.
