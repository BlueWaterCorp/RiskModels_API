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
| `GET /openbb/widgets/snapshot?ticker=` | Risk-snapshot PDF (kept for API; **not** a widget — OpenBB's pdf.js viewer wouldn't render it) | ⚠️ deprecated as widget |
| `GET /openbb/widgets/returns-chart?ticker=&years=` | Cumulative total-return line chart | ✅ live |
| `GET /openbb/widgets/risk-composition?ticker=&years=` | L3 explained-risk over time (line chart) | ✅ live |
| `GET /openbb/widgets/rankings-top?metric=&cohort=&window=&limit=` | Top-ranked names table | ✅ live |
| `GET /openbb/widgets/rankings?ticker=` | Single-name rankings table | ✅ live |

Chart widgets use OpenBB's built-in table `chartView` (`data.table.chartView`,
`chartType: "line"`) — the endpoint returns plain row arrays, so they render as
a line chart and degrade to a readable table. `rankings/screen` is intentionally
skipped (POST-only upstream; OpenBB widgets fetch via GET).

## Widget roadmap (add one route per item, then list it in `widgets.json`)

- **Charts** → `/correlation`, `/macro-factors`, `/returns-decomposition`
  (`/ticker-returns` + `/l3-decomposition` covered by returns-chart /
  risk-composition)
- **Tables** → `/universe/{name}/members`, `/etf-holdings`, `/filer-holdings`
- **HTML / image** → `/snapshot` (multi-position portfolio tearsheet), MCP
  `render_artifact` PNGs. (Single-name `snapshot.pdf` is already live above as
  the `pdf` widget. `snapshot.png` needs `PLAYWRIGHT_PDF_ENABLED=true` upstream
  — prefer the PDF widget, which is pure server-side.)
- **Portfolio** → `/portfolio/risk-snapshot` + L1/L2/L3 hedge layering
- **Apps** → fill out the three-app set in `apps.json`
  (Single-Name Risk · Portfolio Risk & Hedge · Screener)

## AI agent (RiskModels Analyst)

`agents.json` registers one agent; `POST /openbb/query` is its endpoint. It's a
thin adapter — it maps OpenBB's `QueryRequest` messages to our chat format and
proxies to `POST /api/chat` (Claude + the RiskModels tool suite), forwarding the
OpenBB user's `X-API-KEY` as a Bearer token, then streams the answer as
`copilotMessageChunk` SSE. Auth, billing, entitlements, and the analyst doctrine
are reused from `/api/chat` unchanged.

**Add it in OpenBB:** copilot icon → **+** → base URL `https://riskmodels.app/openbb`
(Workspace fetches `agents.json`, uses `/openbb/query` for chat).

Follow-ups: token-level streaming (today it streams the final answer after the
tool loop, with status heartbeats to hold the SSE open); surface tool calls as
`copilotStatusUpdate` / citations; use `widgets`/`context` from the request so
the agent can read the current dashboard.
