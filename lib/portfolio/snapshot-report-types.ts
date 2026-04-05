/**
 * Strict JSON contract for the Playwright/React snapshot report template.
 * Consumed by the /render-snapshot client component via window.__REPORT_DATA__.
 */

export interface SnapshotTickerRow {
  ticker: string;
  weight: number;
  l3_mkt_er: number | null;
  l3_sec_er: number | null;
  l3_sub_er: number | null;
  l3_res_er: number | null;
  l3_mkt_hr: number | null;
  l3_sec_hr: number | null;
  l3_sub_hr: number | null;
  vol_23d: number | null;
  price_close: number | null;
}

export interface SnapshotReportData {
  title: string;
  as_of: string;
  portfolio_risk_index: {
    variance_decomposition: {
      market: number;
      sector: number;
      subsector: number;
      residual: number;
      systematic: number;
    };
    portfolio_volatility_23d: number | null;
    position_count: number;
  };
  per_ticker: SnapshotTickerRow[];
  _metadata: {
    generated_at: string;
    lineage: string;
    billing_code: string;
  };
}

/**
 * Publication palette — aligned with sdk/riskmodels/visuals/styles.py L3_LAYER_COLORS.
 * Market: Blue, Sector: Cyan, Subsector: Orange, Residual: Slate.
 */
export const FACTOR_COLORS = {
  market: "#3b82f6",
  sector: "#06b6d4",
  subsector: "#f97316",
  residual: "#94a3b8",
} as const;

declare global {
  interface Window {
    __REPORT_DATA__?: SnapshotReportData;
  }
}
