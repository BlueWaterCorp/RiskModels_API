/**
 * Whether a latest-metrics snapshot carries an ERM3 decomposition.
 *
 * ETFs (including the SPY / sector / subsector hedge instruments) resolve in
 * the symbol registry but have no decomposition, so every metric comes back
 * null. Batch routes use this to report them as errors instead of a "success"
 * full of nulls.
 */
const CORE_RISK_KEYS = [
  "stock_var",
  "l1_mkt_hr",
  "l3_mkt_hr",
  "l3_mkt_er",
  "l3_res_er",
] as const;

export function hasRiskMetrics(m: Record<string, unknown> | null | undefined): boolean {
  if (!m) return false;
  return CORE_RISK_KEYS.some((k) => {
    const v = m[k];
    return typeof v === "number" && Number.isFinite(v);
  });
}
