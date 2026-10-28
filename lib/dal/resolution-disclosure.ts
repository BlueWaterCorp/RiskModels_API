/**
 * Ticker-resolution disclosure fields (lib/dal/risk-engine-v3 resolvers →
 * response bodies / headers). Kept dependency-free so routes and tests that
 * mock the DAL module still get the real helper.
 */

/**
 * How a ticker with no live registry row of its own was answered.
 *
 *   most_recent_holder  — the security that holds, or most recently held, the
 *                         ticker (CTRA, BBBY).
 *   share_class_sibling — another share class of the same company (ERM3-88:
 *                         GOOGL answered with GOOG's series). Risk, hedge
 *                         ratios and returns are the sibling's; price-bearing
 *                         fields (close, market cap) are withheld because the
 *                         sibling's price is not the requested class's price.
 */
export type ResolvedVia = "most_recent_holder" | "share_class_sibling";

/** The ticker-resolution disclosure fields a row carries (only those set). */
export interface ResolutionDisclosure {
  resolved_via?: ResolvedVia;
  /**
   * With `resolved_via: share_class_sibling`: the ticker the caller asked
   * for (GOOGL), while `modelled_ticker` names the class whose numbers answer.
   */
  requested_ticker?: string;
  /**
   * With `resolved_via`: the answering security's own ticker (registry or
   * security_master) when it differs from the request — e.g. BYON for a
   * pinned BBBY answer, GOOG for a GOOGL request.
   */
  modelled_ticker?: string | null;
  /** With `share_class_sibling`: class letters when known (BRK-A → "A"). */
  share_class?: string | null;
  modelled_share_class?: string | null;
  /**
   * With `share_class_sibling`: true — price fields (price_close,
   * market_cap) are withheld (null or omitted), never the sibling's.
   */
  price_withheld?: boolean;
  delisted?: boolean;
  ticker_reassigned?: boolean;
  current_holder?: { symbol: string; name: string | null };
  resolution_degraded?: boolean;
}

/** Row shape the helpers read (a SymbolRegistryRow satisfies it). */
type DisclosureSource = Omit<ResolutionDisclosure, "requested_ticker" | "price_withheld"> & {
  ticker?: string | null;
};

/** True when the row answers a request with a sibling share class's series. */
export function isShareClassSibling(row: { resolved_via?: ResolvedVia } | null | undefined): boolean {
  return row?.resolved_via === "share_class_sibling";
}

/**
 * Disclosure fields for a response body: exactly the ones resolution set, so
 * ordinary answers stay byte-identical to main. Shared by every disclosing
 * route (/ticker-returns, /tickers, /batch/analyze, /api/data/symbols/*,
 * /metrics, /decompose).
 */
export function resolutionDisclosure(row: DisclosureSource | null | undefined): ResolutionDisclosure {
  const out: ResolutionDisclosure = {};
  if (!row) return out;
  if (row.resolved_via === "share_class_sibling") {
    out.resolved_via = row.resolved_via;
    if (row.ticker) out.requested_ticker = row.ticker;
    if (row.modelled_ticker) out.modelled_ticker = row.modelled_ticker;
    if (row.share_class) out.share_class = row.share_class;
    if (row.modelled_share_class) out.modelled_share_class = row.modelled_share_class;
    out.price_withheld = true;
  } else if (row.resolved_via) {
    out.resolved_via = row.resolved_via;
    if (row.modelled_ticker) out.modelled_ticker = row.modelled_ticker;
  }
  if (row.delisted !== undefined) out.delisted = row.delisted;
  if (row.ticker_reassigned) {
    out.ticker_reassigned = true;
    if (row.current_holder) out.current_holder = row.current_holder;
  }
  if (row.resolution_degraded) out.resolution_degraded = true;
  return out;
}

/** The same disclosure as response headers (csv / parquet carry no envelope). */
export function resolutionDisclosureHeaders(
  row: DisclosureSource | null | undefined,
): Record<string, string> {
  const d = resolutionDisclosure(row);
  const h: Record<string, string> = {};
  if (d.resolved_via) h["X-Ticker-Resolved-Via"] = d.resolved_via;
  if (d.modelled_ticker) h["X-Ticker-Holder-Ticker"] = d.modelled_ticker;
  if (d.price_withheld) h["X-Ticker-Price-Withheld"] = "true";
  if (d.delisted !== undefined) h["X-Ticker-Delisted"] = String(d.delisted);
  if (d.ticker_reassigned) {
    h["X-Ticker-Reassigned"] = "true";
    if (d.current_holder) h["X-Ticker-Current-Holder"] = d.current_holder.symbol;
  }
  if (d.resolution_degraded) h["X-Ticker-Resolution-Degraded"] = "true";
  return h;
}
