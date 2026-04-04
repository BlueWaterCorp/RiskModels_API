/**
 * Ticker / company name search for chat tools and API reuse.
 * Mirrors GET /api/tickers?search= logic (symbols + security_master fallback).
 */

import { createAdminClient } from "@/lib/supabase/admin";

export type TickerSearchRow = {
  /** FactSet-style symbol when available; otherwise same as ticker */
  symbol: string;
  ticker: string;
  name?: string;
  sector?: string;
};

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
    return enrichFromSecurityMaster(rows);
  }

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
