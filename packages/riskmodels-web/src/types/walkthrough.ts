export interface WalkthroughLinePoint {
  date: string;
  gross: number;
  marketHedged: number;
  sectorHedged: number;
  residual: number;
}

export interface WalkthroughYearBar {
  year: number;
  l1_pp: number;
  l2_pp: number;
  l3_pp: number;
  res_pp: number;
  gross_pp: number;
  n_days: number;
  data_as_of: string;
}

export interface WalkthroughSnapshot {
  ticker: string;
  symbol: string;
  name: string | null;
  asOf: string;
  sectorEtf: string | null;
  subsectorEtf: string | null;
  line: WalkthroughLinePoint[];
  bars: WalkthroughYearBar[];
}
