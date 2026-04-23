# @riskmodels/web

TypeScript + React primitives for **ERM3 / RiskModels** visuals in **Next.js** (or any React app). This is the **web** surface area; the Python quant SDK remains [`riskmodels-py`](https://pypi.org/project/riskmodels-py/).

## Install

```bash
npm install @riskmodels/web react react-dom recharts
```

Peer dependencies: `react`, `react-dom`, `recharts` (2.x).

## Build (from monorepo root)

```bash
npm run build:web-sdk
```

## Usage

```tsx
'use client';

import {
  fetchRiskmodelsMetrics,
  mapMetricsToFourBet,
  buildHedgeMapFromFourBet,
  Erm3FourBetCard,
  Erm3HedgeMap,
  LineageStamp,
  type RiskmodelsMetricsResponse,
} from '@riskmodels/web';

const base = process.env.NEXT_PUBLIC_RISKMODELS_BASE_URL ?? 'https://riskmodels.app';

export default function Demo() {
  async function load() {
    const res = await fetchRiskmodelsMetrics(base, 'NVDA', {
      headers: { Authorization: 'Bearer rm_live_YOUR_KEY' },
    });
    const data = (await res.json()) as RiskmodelsMetricsResponse;
    const exposure = mapMetricsToFourBet(data.metrics, data.meta ?? { sector_etf: null, subsector_etf: null });
    const hedge = buildHedgeMapFromFourBet(exposure);
    // render <Erm3FourBetCard exposure={exposure} /> …
  }
  // …
}
```

### riskmodels.app playground rate limit

The portal sends `X-RiskModels-Playground: 1` on session-authenticated `GET /api/metrics/{ticker}` so signed-in landing traffic is capped (10/min). **External apps should omit this header** and use normal API-key limits.

## Exports

- **Types:** `WalkthroughSnapshot`, `RiskmodelsMetricsResponse`, …
- **Theme:** `RISKMODELS_THEME`
- **Charts:** `Erm3WalkthroughLineChart`, `Erm3YearlyAttributionBars`
- **Cards:** `Erm3FourBetCard`, `Erm3HedgeMap`, `LineageStamp`, `ApiCallTabs`
- **Helpers:** `mapMetricsToFourBet`, `buildHedgeMapFromFourBet`, `formatHedgeSummary`, `fetchRiskmodelsMetrics`

## Source

Live in this repo under `packages/riskmodels-web/src`. The portal dogfoods the package on the homepage (`LivePlaygroundDemo`, `DeveloperPlaygroundSection`).

**Server routes** (e.g. Zarr-backed `mag7-hero`) must not import this package entrypoint, because it bundles Recharts. Walkthrough **snapshot shapes** are duplicated in `lib/landing/walkthrough-chart-data.ts` with a comment to keep them aligned with `src/types/walkthrough.ts`.
