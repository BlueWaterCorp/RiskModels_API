import type { FourBetExposure, WalkthroughSnapshot } from '@riskmodels/web';

export const LANDING_PREVIEW_TICKER = 'NVDA';

export interface LandingDecomposePreview {
  ticker: string;
  data_as_of?: string;
  exposure: FourBetExposure;
  hedge: Record<string, number>;
}

export interface LandingPreview {
  decompose: LandingDecomposePreview;
  snapshot: WalkthroughSnapshot | null;
}

let previewPromise: Promise<LandingPreview> | null = null;

async function loadPreview(): Promise<LandingPreview> {
  const [decRes, magRes] = await Promise.all([
    fetch('/api/landing/decompose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: LANDING_PREVIEW_TICKER }),
    }),
    fetch(`/api/landing/walkthrough-chart?ticker=${LANDING_PREVIEW_TICKER}`, {
      method: 'GET',
    }),
  ]);

  const decJson = await decRes.json().catch(() => ({}));
  const magJson = await magRes.json().catch(() => ({}));

  if (!decRes.ok) {
    throw new Error(
      typeof decJson?.message === 'string'
        ? decJson.message
        : typeof decJson?.error === 'string'
          ? decJson.error
          : `decompose ${decRes.status}`,
    );
  }

  return {
    decompose: {
      ticker: decJson.ticker ?? LANDING_PREVIEW_TICKER,
      data_as_of: decJson.data_as_of,
      exposure: decJson.exposure as FourBetExposure,
      hedge: (decJson.hedge ?? {}) as Record<string, number>,
    },
    snapshot: magRes.ok && magJson?.snapshot
      ? (magJson.snapshot as WalkthroughSnapshot)
      : null,
  };
}

export function getLandingPreview(): Promise<LandingPreview> {
  previewPromise ??= loadPreview().catch((error) => {
    previewPromise = null;
    throw error;
  });
  return previewPromise;
}
