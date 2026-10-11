/**
 * Ticker / company name search for chat tools and API reuse.
 * Mirrors GET /api/tickers?search= logic (symbols + security_master fallback).
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { resolveSymbolByTicker } from "@/lib/dal/risk-engine-v3";
import { resolutionDisclosure } from "@/lib/dal/resolution-disclosure";

export type TickerSearchRow = {
  /** FactSet-style symbol when available; otherwise same as ticker */
  symbol: string;
  ticker: string;
  name?: string;
  sector?: string;
  /**
   * Set when no live security holds the ticker and the match is its most
   * recent (possibly delisted) holder — same disclosure as /ticker-returns.
   */
  resolved_via?: "most_recent_holder";
  delisted?: boolean;
  /** The ticker now belongs to a security the API cannot serve (FB). */
  ticker_reassigned?: boolean;
  current_holder?: { symbol: string; name: string | null };
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

async function enrichFromSecurityMaster(
  rows: TickerSearchRow[],
): Promise<TickerSearchRow[]> {
  const need = rows.filter((r) => !r.name || r.name === r.ticker);
  if (need.length === 0) return rows;
  const tickers = need.map((r) => r.ticker);
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("security_master")
      .select("ticker, company_name, sector_etf")
      .in("ticker", tickers)
      .is("valid_to", null);
    if (!data?.length) return rows;
    const byTicker = new Map(
      (data as { ticker: string; company_name: string | null; sector_etf: string | null }[]).map(
        (r) => [r.ticker.toUpperCase(), r],
      ),
    );
    return rows.map((r) => {
      const sm = byTicker.get(r.ticker.toUpperCase());
      if (!sm) return r;
      return {
        ...r,
        name: sm.company_name || r.name || r.ticker,
        sector: sm.sector_etf ?? r.sector,
      };
    });
  } catch {
    return rows;
  }
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
    .select("ticker, metadata")
    .or(`ticker.ilike.%${upperSearch}%,metadata->>company_name.ilike.%${upperSearch}%`)
    .limit(10);

  if (!metadataError && metadataMatches && metadataMatches.length > 0) {
    const rows: TickerSearchRow[] = (metadataMatches as {
      ticker: string;
      metadata?: { company_name?: string; sector?: string; gics_sector_name?: string };
    }[]).map((m) => ({
      symbol: m.ticker,
      ticker: m.ticker,
      name: includeMetadata
        ? m.metadata?.company_name || m.ticker
        : undefined,
      sector: includeMetadata
        ? m.metadata?.sector || m.metadata?.gics_sector_name
        : undefined,
    }));
    const exactLive = (metadataMatches as { ticker: string; metadata?: { is_delisted?: boolean } }[]).some(
      (m) => m.ticker.toUpperCase() === upperSearch && m.metadata?.is_delisted !== true,
    );
    if (!exactLive) {
      // Fuzzy hits (CTRA → nothing, MF → MFA, MFC, …) or only a dead exact
      // row: lead with the resolver's holder when the most-recent-holder pass
      // chose one (it replaces the dead row only for a live holder).
      const holder = await mostRecentHolderRow(upperSearch);
      if (holder) {
        const rest = rows.filter((r) => r.ticker.toUpperCase() !== upperSearch);
        return enrichFromSecurityMaster([holder, ...rest].slice(0, 10));
      }
    }
    return enrichFromSecurityMaster(rows);
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
