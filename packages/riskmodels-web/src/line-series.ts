import { RISKMODELS_THEME } from './theme';

export type WalkthroughLineSeriesKey = 'gross' | 'marketHedged' | 'sectorHedged' | 'residual';

export interface WalkthroughLineSeriesDef {
  key: WalkthroughLineSeriesKey;
  label: string;
  color: string;
  dash?: string;
}

export const ERM3_WALKTHROUGH_LINE_SERIES: WalkthroughLineSeriesDef[] = [
  { key: 'gross', label: 'Gross return', color: RISKMODELS_THEME.chart.gross, dash: '6 4' },
  { key: 'marketHedged', label: 'After market hedge', color: RISKMODELS_THEME.chart.marketHedged },
  { key: 'sectorHedged', label: 'After sector hedge', color: RISKMODELS_THEME.chart.sectorHedged },
  { key: 'residual', label: 'Residual alpha proxy', color: RISKMODELS_THEME.chart.residual },
];
