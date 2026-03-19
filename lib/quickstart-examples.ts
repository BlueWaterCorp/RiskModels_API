/**
 * Quickstart "Longer examples" tab ids — shared by landing page links and /quickstart.
 */
export type QuickstartExampleTabId =
  | 'decomposition'
  | 'hedgeSnapshot'
  | 'historical'
  | 'batch';

const TAB_IDS: QuickstartExampleTabId[] = [
  'decomposition',
  'hedgeSnapshot',
  'historical',
  'batch',
];

export function isQuickstartExampleTabId(
  value: string | null | undefined
): value is QuickstartExampleTabId {
  return value != null && (TAB_IDS as string[]).includes(value);
}

/** Landing + marketing copy (matches legacy "What you can do" titles). */
export const QUICKSTART_LANDING_CARDS: {
  id: QuickstartExampleTabId;
  title: string;
  description: string;
}[] = [
  {
    id: 'decomposition',
    title: 'Daily Factor Decompositions',
    description: 'Market, sector, subsector explained risk',
  },
  {
    id: 'hedgeSnapshot',
    title: 'Hedge Ratios (L1/L2/L3)',
    description: 'Dollar-denominated ETF hedge amounts',
  },
  {
    id: 'historical',
    title: 'Historical Time Series',
    description: '15+ years of rolling hedge ratios',
  },
  {
    id: 'batch',
    title: 'Batch Analysis',
    description: 'Analyze up to 100 tickers at once',
  },
];

export function quickstartExampleHref(id: QuickstartExampleTabId): string {
  return `/quickstart?example=${encodeURIComponent(id)}#code-examples`;
}
