/**
 * Ticker-resolution disclosure fields (lib/dal/risk-engine-v3 resolvers →
 * response bodies / headers). Kept dependency-free so routes and tests that
 * mock the DAL module still get the real helper.
 */

/** The ticker-resolution disclosure fields a row carries (only those set). */
export interface ResolutionDisclosure {
  resolved_via?: "most_recent_holder";
  delisted?: boolean;
  ticker_reassigned?: boolean;
  current_holder?: { symbol: string; name: string | null };
}

/**
 * Disclosure fields for a response body: exactly the ones resolution set, so
 * ordinary answers stay byte-identical to main. Shared by every disclosing
 * route (/ticker-returns, /tickers, /batch/analyze, /api/data/symbols/*).
 */
export function resolutionDisclosure(row: ResolutionDisclosure | null | undefined): ResolutionDisclosure {
  const out: ResolutionDisclosure = {};
  if (!row) return out;
  if (row.resolved_via) out.resolved_via = row.resolved_via;
  if (row.delisted !== undefined) out.delisted = row.delisted;
  if (row.ticker_reassigned) {
    out.ticker_reassigned = true;
    if (row.current_holder) out.current_holder = row.current_holder;
  }
  return out;
}

/** The same disclosure as response headers (csv / parquet carry no envelope). */
export function resolutionDisclosureHeaders(
  row: ResolutionDisclosure | null | undefined,
): Record<string, string> {
  const d = resolutionDisclosure(row);
  const h: Record<string, string> = {};
  if (d.resolved_via) h["X-Ticker-Resolved-Via"] = d.resolved_via;
  if (d.delisted !== undefined) h["X-Ticker-Delisted"] = String(d.delisted);
  if (d.ticker_reassigned) {
    h["X-Ticker-Reassigned"] = "true";
    if (d.current_holder) h["X-Ticker-Current-Holder"] = d.current_holder.symbol;
  }
  return h;
}
