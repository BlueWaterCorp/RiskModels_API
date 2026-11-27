/**
 * Coverage facts published once, in GET /api/health `coverage`, and quoted from
 * there by the site, llms.txt and the docs: first served date per product, the
 * size of the named universe on its latest date, and the stock record count.
 */

import { SERVED_HISTORY_START } from "./served-history";
import { readUniverseMembers } from "./zarr-reader";
import { createAdminClient } from "@/lib/supabase/admin";

export const COVERAGE_UNIVERSE = "uni_mc_3000";

export interface CoverageFacts {
  /** First date each product is served from (ISO). */
  history_starts: {
    /** Split- and dividend-adjusted daily returns. */
    returns: string;
    hedge_ratio: string;
    explained_risk: string;
    residual_share: string;
    lstar: string;
  };
  /** Active members of the named universe on its latest date; null when unavailable. */
  universe: { label: string; as_of: string; member_count: number } | null;
  /** US stocks with a record in the API, delisted names included; null when unavailable. */
  stock_records: number | null;
}

/** First date of the returns history. */
const RETURNS_HISTORY_START = "2006-01-04";

export async function getCoverageFacts(): Promise<CoverageFacts> {
  let universe: CoverageFacts["universe"] = null;
  try {
    const r = await readUniverseMembers(COVERAGE_UNIVERSE);
    if (r) universe = { label: COVERAGE_UNIVERSE, as_of: r.teo, member_count: r.counts.active };
  } catch {
    universe = null;
  }
  let stock_records: number | null = null;
  try {
    const { count } = await createAdminClient()
      .from("symbols")
      .select("*", { count: "exact", head: true })
      .eq("asset_type", "stock");
    stock_records = count ?? null;
  } catch {
    stock_records = null;
  }
  return {
    history_starts: {
      returns: RETURNS_HISTORY_START,
      hedge_ratio: SERVED_HISTORY_START.hedge_ratio,
      explained_risk: SERVED_HISTORY_START.explained_risk,
      residual_share: SERVED_HISTORY_START.returns_decomposition,
      lstar: SERVED_HISTORY_START.lstar,
    },
    universe,
    stock_records,
  };
}
