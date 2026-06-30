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
| `GET /openbb/widgets/metrics?ticker=` | Single-name risk table | ✅ live |
| `GET /openbb/widgets/snapshot?ticker=` | Risk-snapshot tearsheet (`pdf` widget) | ✅ live |

## Widget roadmap (add one route per item, then list it in `widgets.json`)

- **Charts** → `/ticker-returns`, `/returns`, `/correlation`, `/macro-factors`,
  `/l3-decomposition`, `/returns-decomposition`
- **Tables** → `/rankings/screen`, `/rankings/top`, `/universe/{name}/members`,
  `/etf-holdings`, `/filer-holdings`
- **HTML / image** → `/snapshot` (multi-position portfolio tearsheet), MCP
  `render_artifact` PNGs. (Single-name `snapshot.pdf` is already live above as
  the `pdf` widget. `snapshot.png` needs `PLAYWRIGHT_PDF_ENABLED=true` upstream
  — prefer the PDF widget, which is pure server-side.)
- **Portfolio** → `/portfolio/risk-snapshot` + L1/L2/L3 hedge layering
- **Apps** → fill out the three-app set in `apps.json`
  (Single-Name Risk · Portfolio Risk & Hedge · Screener)

Then register the published npm `riskmodels` MCP server as a Workspace AI agent.
