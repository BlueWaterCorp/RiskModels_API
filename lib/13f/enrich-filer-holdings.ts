/**
 * Enrich filer holdings from zarr with latest L3 ER + optional ticker labels
 * via `security_history_latest` (same bw_sym_id key as fund V3 reads).
 */

import { fetchBatchLatestSummary } from "@/lib/dal/risk-engine-v3";
import type { FilerHoldingsSnapshot } from "@/lib/dal/funds-zarr-reader";

export async function enrichFilerHoldingsWithL3(
  snap: FilerHoldingsSnapshot | null,
): Promise<FilerHoldingsSnapshot | null> {
  if (!snap?.holdings.length) return snap;

  const ids = [...new Set(snap.holdings.map((h) => h.security_id).filter(Boolean))];
  const batch = await fetchBatchLatestSummary(ids, "daily");

  const holdings = snap.holdings.map((h) => {
    const row = batch.get(h.security_id);
    const m = row?.metrics;
    if (!m) return { ...h };
    return {
      ...h,
      l3_market_er: m.l3_mkt_er ?? null,
      l3_sector_er: m.l3_sec_er ?? null,
      l3_subsector_er: m.l3_sub_er ?? null,
      l3_residual_er: m.l3_res_er ?? null,
    };
  });

  return { ...snap, holdings };
}
