/**
 * Enrich filer holdings from zarr with latest L3 ER (via
 * `security_history_latest`) and display labels — ticker + company name —
 * (via `public.symbols`; same bw_sym_id key namespace post-D.8.1).
 *
 * Both lookups are best-effort: a miss leaves the holding's optional
 * fields unset rather than failing the response.
 *
 * G.100: a miss caused by the SHARE CLASS is recoverable. `ds_daily`
 * models one class per company, so a holding reported in a sibling class
 * (Berkshire's Alphabet Class A) has no `security_history_latest` or
 * `symbols` row of its own. For those ids the company map projects
 * `bw_sym_id → company → modelled class` — resolved at the snapshot's
 * `report_date`, the G.101 PIT constraint — and the holding gets its own
 * identity, the sibling's L3, and a `modelled_as` disclosure. Until the
 * mirror's first publish, the projection resolves nothing and behavior is
 * exactly the pre-G.100 pass-through.
 */

import { fetchBatchLatestSummary } from "@/lib/dal/risk-engine-v3";
import { resolveDisplayLabels } from "@/lib/dal/symbols-batch";
import { buildShareClassPatches } from "@/lib/holdings/share-class-projection";
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

  const missed = ids.filter((id) => !batch.get(id));
  const patches = await buildShareClassPatches(missed, snap.report_date);

  const holdings = snap.holdings.map((h) => {
    const row = batch.get(h.security_id);
    const m = row?.metrics;
    const label = labels.get(h.security_id);
    const patch = m ? undefined : patches.get(h.security_id);
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
      ...(patch
        ? {
            ...(label ? {} : { ticker: patch.ticker, name: patch.name }),
            ...(patch.l3 ?? {}),
            modelled_as: patch.modelled_as,
          }
        : {}),
    };
  });

  return { ...snap, holdings };
}
