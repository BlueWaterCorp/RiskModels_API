/**
 * Enrich filer holdings from zarr with latest L3 ER (via
 * `security_history_latest`) and display labels — ticker + company name —
 * (via `public.symbols`; same bw_sym_id key namespace post-D.8.1).
 *
 * Both lookups are best-effort: a miss leaves the holding's optional
 * fields unset rather than failing the response.
 */

import { fetchBatchLatestSummary } from "@/lib/dal/risk-engine-v3";
import { resolveDisplayLabels } from "@/lib/dal/symbols-batch";
import type { FilerHoldingsSnapshot } from "@/lib/dal/funds-zarr-reader";

export async function enrichFilerHoldingsWithL3(
  snap: FilerHoldingsSnapshot | null,
): Promise<FilerHoldingsSnapshot | null> {
  if (!snap?.holdings.length) return snap;

  const ids = [...new Set(snap.holdings.map((h) => h.security_id).filter(Boolean))];
  const [batch, labels] = await Promise.all([
    fetchBatchLatestSummary(ids, "daily"),
    resolveDisplayLabels(ids),
  ]);

  const holdings = snap.holdings.map((h) => {
    const row = batch.get(h.security_id);
    const m = row?.metrics;
    const label = labels.get(h.security_id);
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
