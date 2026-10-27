/**
 * Ticker / company name search for chat tools and API reuse.
 * Mirrors GET /api/tickers?search= logic (symbols + security_master fallback).
 *
 * Labels (name, sector ETF, subsector ETF) come from the `symbols` registry's
 * own columns, keyed by the registry row. They are never looked up in the
 * security_master mirror by ticker: a ticker can have several open mirror rows
 * (warrants, second identities), and which one a ticker match returns depends
 * on row order.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { resolveSymbolByTicker } from "@/lib/dal/risk-engine-v3";
import { resolutionDisclosure } from "@/lib/dal/resolution-disclosure";

export type TickerSearchRow = {
  /** Internal BW symbol when available; otherwise same as ticker */
  symbol: string;
  ticker: string;
  name?: string;
  sector?: string;
  /**
   * Set when no live security holds the ticker and the match is its most
   * recent (possibly delisted) holder — same disclosure as /ticker-returns.
   */
  resolved_via?: "most_recent_holder";
  /** With resolved_via: the answering security's own ticker when it differs. */
  modelled_ticker?: string | null;
  delisted?: boolean;
  /** The ticker now belongs to a security the API cannot serve (FB). */
  ticker_reassigned?: boolean;
  current_holder?: { symbol: string; name: string | null };
  resolution_degraded?: boolean;
};

/**
 * Ticker-shaped query (no spaces, 2-10 chars of A-Z / 0-9 / . / -). One-
 * letter queries (typeahead's first keystroke) never pay the holder pass.
 */
const TICKER_SHAPE = /^[A-Z0-9][A-Z0-9.-]{1,9}$/;

/**
 * Exact-ticker match from the shared DAL resolver's most-recent-holder pass
 * (delisted names such as CTRA that the live `symbols` mirror no longer
 * carries). Null for ordinary tickers, which the symbols queries already
 * answer, and for non-ticker-shaped queries.
 */
async function mostRecentHolderRow(upperSearch: string): Promise<TickerSearchRow | null> {
  if (!TICKER_SHAPE.test(upperSearch)) return null;
  try {
    const rec = await resolveSymbolByTicker(upperSearch, { disclosing: true });
    if (!rec?.resolved_via && !rec?.ticker_reassigned) return null;
    return {
      symbol: upperSearch,
      ticker: upperSearch,
      name: rec.name ?? upperSearch,
      sector: rec.sector_etf ?? undefined,
      ...resolutionDisclosure(rec),
    };
  } catch {
    return null;
  }
}

/** `symbols` columns read for labels. */
export const SYMBOL_LABEL_COLUMNS = "ticker, name, sector_etf, subsector_etf, metadata";

export type SymbolLabelRow = {
  ticker: string;
  name?: string | null;
  sector_etf?: string | null;
  subsector_etf?: string | null;
  metadata?: {
    sector?: string | null;
    gics_sector_name?: string | null;
    is_delisted?: boolean;
  } | null;
};

/** One entry of GET /api/tickers?include_metadata=true `metadata`. */
export type TickerMetadataEntry = {
  name: string;
  sector?: string;
  sector_etf?: string;
  subsector_etf?: string;
};

/**
 * Metadata entry for one `symbols` row. Missing values are omitted (not
 * null), and a missing name falls back to the ticker.
 */
export function tickerMetadataEntry(row: SymbolLabelRow): TickerMetadataEntry {
  return {
    name: row.name || row.ticker,
    sector: row.metadata?.sector || row.metadata?.gics_sector_name || undefined,
    sector_etf: row.sector_etf || undefined,
    subsector_etf: row.subsector_etf || undefined,
  };
}

/**
 * Search symbols by ticker or company name (max 10 matches).
 * Used by chat tool search_tickers (free) and can back /api/tickers?search=.
 */
export async function searchTickers(
  query: string,
  includeMetadata = true,
): Promise<TickerSearchRow[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const upperSearch = trimmed.toUpperCase();
  const admin = createAdminClient();

  const { data: metadataMatches, error: metadataError } = await admin
    .from("symbols")
    .select(SYMBOL_LABEL_COLUMNS)
    .or(`ticker.ilike.%${upperSearch}%,name.ilike.%${upperSearch}%`)
    .limit(10);

  if (!metadataError && metadataMatches && metadataMatches.length > 0) {
    const matches = metadataMatches as SymbolLabelRow[];
    const rows: TickerSearchRow[] = matches.map((m) => ({
      symbol: m.ticker,
      ticker: m.ticker,
      name: includeMetadata ? m.name || m.ticker : undefined,
      // `sector` here has always carried the sector ETF.
      sector: includeMetadata ? m.sector_etf || undefined : undefined,
    }));
    const exactLive = matches.some(
      (m) => m.ticker.toUpperCase() === upperSearch && m.metadata?.is_delisted !== true,
    );
    if (!exactLive) {
      // Fuzzy hits (CTRA → nothing, MF → MFA, MFC, …) or only a dead exact
      // row: lead with the resolver's holder when the most-recent-holder pass
      // chose one (it replaces the dead row only for a live holder).
      const holder = await mostRecentHolderRow(upperSearch);
      if (holder) {
        const rest = rows.filter((r) => r.ticker.toUpperCase() !== upperSearch);
        return [holder, ...rest].slice(0, 10);
      }
    }
    return rows;
  }

  const holder = await mostRecentHolderRow(upperSearch);
  if (holder) return [holder];

  try {
    const { data: smMatches } = await admin
      .from("security_master")
      .select("ticker, company_name, sector_etf")
      .ilike("company_name", `%${trimmed}%`)
      .is("valid_to", null)
      .limit(10);

    if (smMatches && smMatches.length > 0) {
      return (smMatches as {
        ticker: string;
        company_name: string | null;
        sector_etf: string | null;
      }[]).map((m) => ({
        symbol: m.ticker,
        ticker: m.ticker,
        name: includeMetadata ? m.company_name || m.ticker : undefined,
        sector: includeMetadata ? m.sector_etf ?? undefined : undefined,
      }));
    }
  } catch {
    // fall through
  }

  const { data: exactMatch } = await admin
    .from("symbols")
    .select("ticker")
    .eq("ticker", upperSearch)
    .limit(1)
    .maybeSingle();

  if (exactMatch) {
    const m = exactMatch as { ticker: string };
    return [
      {
        symbol: m.ticker,
        ticker: m.ticker,
      },
    ];
  }

  return [
    {
      symbol: upperSearch,
      ticker: upperSearch,
      name: undefined,
      sector: undefined,
    },
  ];
}
