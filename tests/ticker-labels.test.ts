import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));
vi.mock("@/lib/dal/risk-engine-v3", () => ({
  resolveSymbolByTicker: vi.fn(async () => null),
  fetchTradingCalendar: vi.fn(async () => []),
}));

import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { GET } from "@/app/api/tickers/route";
import { searchTickers, tickerMetadataEntry } from "@/lib/dal/ticker-search";

type Row = Record<string, unknown>;

/**
 * Real `symbols` rows (ticker, name, sector_etf, subsector_etf, metadata) read
 * from production Supabase on 2026-10-22. The registry key column is not
 * needed by these reads and is left out.
 */
const SYMBOLS: Row[] = [
  { ticker: "AAPL", name: "Apple Inc.", sector_etf: "XLK", subsector_etf: "RSPT", metadata: { is_delisted: false } },
  { ticker: "AMZN", name: "Amazon.com, Inc.", sector_etf: "XLY", subsector_etf: "XRT", metadata: { is_delisted: false } },
  { ticker: "META", name: "Meta Platforms Inc Class A", sector_etf: "XLC", subsector_etf: "FDN", metadata: { is_delisted: false } },
  { ticker: "MSFT", name: "Microsoft Corporation", sector_etf: "XLK", subsector_etf: "IGV", metadata: { is_delisted: false } },
  { ticker: "NVDA", name: "NVIDIA Corporation", sector_etf: "XLK", subsector_etf: "SMH", metadata: { is_delisted: false } },
  { ticker: "TSLA", name: "Tesla, Inc.", sector_etf: "XLY", subsector_etf: "CARZ", metadata: { is_delisted: false } },
  { ticker: "BKSY", name: "BlackSky Technology Inc Class A", sector_etf: "XLI", subsector_etf: "PPA", metadata: { is_delisted: false } },
  { ticker: "EQPT", name: "EquipmentShare.com Inc", sector_etf: "XLI", subsector_etf: "IYJ", metadata: { is_delisted: false } },
  { ticker: "PAY", name: "Paymentus Holdings, Inc Class A", sector_etf: "XLF", subsector_etf: "IYG", metadata: { is_delisted: false } },
  { ticker: "RYZ", name: "Ryerson Holding Corp", sector_etf: "XLB", subsector_etf: "XME", metadata: { is_delisted: false } },
  { ticker: "SUNB", name: "Sunbelt Rentals Holdings, Inc.", sector_etf: "XLI", subsector_etf: "IYJ", metadata: { is_delisted: false } },
  { ticker: "GLD", name: null, sector_etf: null, subsector_etf: null, metadata: {} },
];

/**
 * Real open security_master mirror rows for the same date: two open rows per
 * ticker (a warrant or a second identity), each carrying stale labels. A
 * ticker match on these returned whichever row came last.
 */
const MIRROR: Row[] = [
  { ticker: "BKSY", company_name: "BlackSky Technology Inc.", sector_etf: "XLK", subsector_etfs: '["IDGT"]', valid_to: null },
  { ticker: "BKSY", company_name: "BlackSky Technology Inc.", sector_etf: "XLK", subsector_etfs: '["IDGT"]', valid_to: null },
  { ticker: "PAY", company_name: "Paymentus Holdings, Inc.", sector_etf: "XLF", subsector_etfs: '["KIE"]', valid_to: null },
  { ticker: "PAY", company_name: "Paymentus Holdings, Inc.", sector_etf: "XLI", subsector_etfs: '["IYJ"]', valid_to: null },
  { ticker: "RYZ", company_name: "Ryerson Holding Corp", sector_etf: "XLY", subsector_etfs: '["XRT"]', valid_to: null },
  { ticker: "SUNB", company_name: "Sunbelt Rentals Holdings, Inc.", sector_etf: "XLF", subsector_etfs: '["IYG"]', valid_to: null },
];

let mirrorReads = 0;

function stubSupabase() {
  return {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let limit: number | null = null;
      if (table === "security_master") mirrorReads += 1;
      const base = table === "symbols" ? SYMBOLS : table === "security_master" ? MIRROR : [];
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.in = (col: string, vs: unknown[]) => {
        filters.push((r) => vs.includes(r[col]));
        return q;
      };
      q.eq = (col: string, v: unknown) => {
        filters.push((r) => r[col] === v);
        return q;
      };
      q.is = () => q;
      q.ilike = () => q;
      q.or = (expr: string) => {
        // `ticker.ilike.%X%,name.ilike.%X%` → case-insensitive contains.
        const clauses = expr.split(",").map((c) => {
          const [col, , pat] = c.split(".");
          return { col, needle: pat.replace(/%/g, "").toUpperCase() };
        });
        filters.push((r) =>
          clauses.some(({ col, needle }) => String(r[col] ?? "").toUpperCase().includes(needle)),
        );
        return q;
      };
      q.order = () => q;
      q.limit = (n: number) => {
        limit = n;
        return q;
      };
      const rows = () => {
        const out = base.filter((r) => filters.every((f) => f(r)));
        return limit === null ? out : out.slice(0, limit);
      };
      q.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
      (q as { then?: unknown }).then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: rows(), error: null }).then(resolve);
      return q;
    },
  };
}

beforeEach(() => {
  mirrorReads = 0;
  vi.mocked(createAdminClient).mockReturnValue(stubSupabase() as never);
});

describe("tickerMetadataEntry", () => {
  it("reads the symbols columns and omits missing values", () => {
    expect(tickerMetadataEntry(SYMBOLS[8] as never)).toEqual({
      name: "Paymentus Holdings, Inc Class A",
      sector: undefined,
      sector_etf: "XLF",
      subsector_etf: "IYG",
    });
    const gld = tickerMetadataEntry(SYMBOLS[11] as never);
    expect(gld.name).toBe("GLD");
    expect(JSON.parse(JSON.stringify(gld))).toEqual({ name: "GLD" });
  });
});

describe("GET /api/tickers?include_metadata=true", () => {
  it("labels every ticker from its own symbols row, never from the mirror", async () => {
    const res = await GET(new NextRequest("http://test/api/tickers?include_metadata=true"));
    const body = await res.json();
    expect(mirrorReads).toBe(0);
    expect(body.tickers).toHaveLength(SYMBOLS.length);
    expect(body.metadata.PAY).toEqual({
      name: "Paymentus Holdings, Inc Class A",
      sector_etf: "XLF",
      subsector_etf: "IYG",
    });
    expect(body.metadata.BKSY).toEqual({
      name: "BlackSky Technology Inc Class A",
      sector_etf: "XLI",
      subsector_etf: "PPA",
    });
    // subsector_etf is a plain ETF ticker, as OPENAPI_SPEC.yaml declares.
    for (const m of Object.values(body.metadata) as { subsector_etf?: string }[]) {
      if (m.subsector_etf !== undefined) expect(m.subsector_etf).toMatch(/^[A-Z]+$/);
    }
    expect(body.metadata.GLD).toEqual({ name: "GLD" });
  });

  it("mag7 metadata comes from the same columns", async () => {
    const res = await GET(new NextRequest("http://test/api/tickers?mag7=true&include_metadata=true"));
    const body = await res.json();
    expect(mirrorReads).toBe(0);
    expect(body.metadata.NVDA).toEqual({
      name: "NVIDIA Corporation",
      sector_etf: "XLK",
      subsector_etf: "SMH",
    });
  });
});

describe("searchTickers", () => {
  it("matches company names on symbols.name and returns its sector ETF", async () => {
    const rows = await searchTickers("ryerson");
    expect(mirrorReads).toBe(0);
    expect(rows).toEqual([
      { symbol: "RYZ", ticker: "RYZ", name: "Ryerson Holding Corp", sector: "XLB" },
    ]);
  });

  it("labels a ticker with duplicate open mirror rows from its registry row", async () => {
    const rows = await searchTickers("SUNB");
    expect(rows[0]).toEqual({
      symbol: "SUNB",
      ticker: "SUNB",
      name: "Sunbelt Rentals Holdings, Inc.",
      sector: "XLI",
    });
  });
});
