/**
 * Enrich fund holdings (from `fund_holdings_top`) with latest L3 ER (via
 * `security_history_latest`) and display labels — ticker + company name —
 * (via `public.symbols`). Keyed on `bw_sym_id` (= the holdings `symbol`).
 *
 * Mirrors `lib/13f/enrich-filer-holdings.ts`. Both lookups are best-effort:
 * a miss leaves the holding's optional fields unset rather than failing the
 * response. This is the read-time join the requirements call for — l3 refreshes
 * daily while holdings are quarterly, so they are stored separately.
 */

import { fetchBatchLatestSummary } from "@/lib/dal/risk-engine-v3";
import { resolveDisplayLabels } from "@/lib/dal/symbols-batch";
import type { FundHoldingsSnapshot } from "@/lib/dal/funds-zarr-reader";

export async function enrichFundHoldingsWithL3(
  snap: FundHoldingsSnapshot | null,
): Promise<FundHoldingsSnapshot | null> {
  if (!snap?.holdings.length) return snap;

  const ids = [...new Set(snap.holdings.map((h) => h.bw_sym_id).filter(Boolean))];
  const [batch, labels] = await Promise.all([
    fetchBatchLatestSummary(ids, "daily"),
    resolveDisplayLabels(ids),
  ]);

  const holdings = snap.holdings.map((h) => {
    const m = batch.get(h.bw_sym_id)?.metrics;
    const label = labels.get(h.bw_sym_id);
    return {
      ...h,
      ...(label ? { ticker: label.ticker, name: label.name } : {}),
      ...(m
        ? {
            l3_market_er: m.l3_mkt_er ?? null,
            l3_sector_er: m.l3_sec_er ?? null,
            l3_subsector_er: m.l3_sub_er ?? null,
            l3_residual_er: m.l3_res_er ?? null,
          }
        : {}),
    };
  });

  return { ...snap, holdings };
}
