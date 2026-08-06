/**
 * Read-time share-class patches for holdings enrichment (G.100).
 *
 * Shared by `lib/13f/enrich-filer-holdings.ts` and
 * `lib/funds/enrich-fund-holdings.ts` — the two id-first enrichment paths
 * whose lookups miss for non-modelled share classes. For each missed id
 * that the company map projects, this builds the fields the enricher could
 * not: the holding's OWN identity (the requested class's ticker/name — a
 * Berkshire GOOGL row is labelled GOOGL / Class A, never renamed to GOOG)
 * and the modelled sibling's L3 explained-risk shares, with the
 * substitution disclosed in `modelled_as` per the G.35 doctrine: answering
 * one security with another's numbers must be reported, never silent.
 *
 * L3 comes from `security_history_latest` for the sibling — latest-daily,
 * the same vintage semantics the enrichers already use for directly
 * modelled holdings. What is point-in-time is the CLASS MAPPING (`asOf` =
 * the snapshot's report date), so a historical filing cannot project onto
 * a class that did not exist yet.
 */

import { fetchBatchLatestSummary } from "@/lib/dal/risk-engine-v3";
import { resolveDisplayLabels } from "@/lib/dal/symbols-batch";
import {
  resolveShareClassProjections,
  type ShareClassProjection,
} from "@/lib/dal/company-map";

/** Disclosure block attached to a projected holding. */
export interface ModelledAs {
  /** The sibling class whose modelled series supplied the risk fields. */
  security_id: string;
  ticker: string | null;
  requested_class: string | null;
  modelled_class: string | null;
}

export interface ShareClassPatch {
  ticker: string | null;
  name: string | null;
  l3: {
    l3_market_er: number | null;
    l3_sector_er: number | null;
    l3_subsector_er: number | null;
    l3_residual_er: number | null;
  } | null;
  modelled_as: ModelledAs;
}

/**
 * Patches for the subset of `missedIds` the company map projects at `asOf`.
 * Ids the map does not know (or that have no modelled sibling then) get no
 * entry — blank is the truth for those. Never throws; a downstream fetch
 * failure degrades to identity-only patches.
 */
export async function buildShareClassPatches(
  missedIds: string[],
  asOf?: string,
): Promise<Map<string, ShareClassPatch>> {
  const out = new Map<string, ShareClassPatch>();
  if (!missedIds.length) return out;

  const projections = await resolveShareClassProjections(missedIds, asOf);
  if (!projections.size) return out;

  const modelledIds = [
    ...new Set([...projections.values()].map((p) => p.modelled_security_id)),
  ];
  const [batch, labels] = await Promise.all([
    fetchBatchLatestSummary(modelledIds, "daily"),
    resolveDisplayLabels(modelledIds),
  ]);

  for (const [id, p] of projections) {
    out.set(id, buildPatch(p, batch, labels));
  }
  return out;
}

function buildPatch(
  p: ShareClassProjection,
  batch: Awaited<ReturnType<typeof fetchBatchLatestSummary>>,
  labels: Awaited<ReturnType<typeof resolveDisplayLabels>>,
): ShareClassPatch {
  const m = batch.get(p.modelled_security_id)?.metrics;
  const siblingLabel = labels.get(p.modelled_security_id);
  return {
    // The holding's own identity: the requested class's ticker, its own
    // name where the map carries one, the same-issuer sibling's name as the
    // fallback (same company — the name is truthful either way).
    ticker: p.requested_ticker,
    name: p.requested_name ?? siblingLabel?.name ?? null,
    l3: m
      ? {
          l3_market_er: m.l3_mkt_er ?? null,
          l3_sector_er: m.l3_sec_er ?? null,
          l3_subsector_er: m.l3_sub_er ?? null,
          l3_residual_er: m.l3_res_er ?? null,
        }
      : null,
    modelled_as: {
      security_id: p.modelled_security_id,
      ticker: p.modelled_ticker ?? siblingLabel?.ticker ?? null,
      requested_class: p.requested_class,
      modelled_class: p.modelled_class,
    },
  };
}
