import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/dal/zarr-reader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/dal/zarr-reader")>()),
  readDailyTickerHolderIndex: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { readDailyTickerHolderIndex } from "@/lib/dal/zarr-reader";
import { resolveSymbolByTicker, resolveSymbolsByTickers } from "@/lib/dal/risk-engine-v3";
import { rankHolderCandidates } from "@/lib/dal/ticker-holder";
import { searchTickers } from "@/lib/dal/ticker-search";
import { GET as getSymbol } from "@/app/api/data/symbols/[ticker]/route";
import { _resetClassProjectionsCache } from "@/lib/ticker-aliases";

/**
 * Delisted-ticker recall (2026-10-10). `public.symbols` mirrors the modelled
 * universe only, so a ticker whose holder left it answered "Ticker not found"
 * although ds_daily still carries the history:
 *   CTRA → Coterra, BW-BBG000C3GN47 (delisted; last bar 2026-05-07)
 *   BBBY → Overstock / Beyond / Bed Bath & Beyond, BW-BBG000BBQDH7
 * The resolver now falls back to the security that held the ticker most
 * recently. A live holder must always win: recycled tickers (WM, CC, GM, MF,
 * WB) keep resolving to today's company.
 *
 * Fixtures mirror production rows read on 2026-10-10 (symbols,
 * security_aliases, security_master, ds_daily `ticker`/`unique_ticker`/
 * `eodhd_code` coords). BBBY uses the post-ERM3-listing-pin shape
 * (BBBY.US); see the last test for today's BYON-labelled store.
 */

type Row = Record<string, unknown>;

function sym(symbol: string, ticker: string, opts: { dead?: boolean; name?: string } = {}): Row {
  return {
    symbol,
    ticker,
    name: opts.name ?? null,
    asset_type: "stock",
    sector_etf: "XLK",
    subsector_etf: null,
    is_adr: null,
    metadata: opts.dead ? { is_delisted: true } : { is_delisted: false },
  };
}

function sm(
  bw_sym_id: string,
  ticker: string,
  opts: {
    unique?: string;
    name?: string;
    live?: boolean;
    valid_to?: string | null;
    sector?: string | null;
    subsectors?: string | null;
  } = {},
): Row {
  const live = opts.live ?? true;
  return {
    bw_sym_id,
    ticker,
    unique_ticker: opts.unique ?? ticker,
    company_name: opts.name ?? null,
    sector_etf: opts.sector ?? null,
    subsector_etfs: opts.subsectors ?? null,
    asset_type: "EQUITY",
    is_adr: false,
    is_active: live,
    is_delisted: !live,
    valid_to: live ? null : (opts.valid_to ?? null),
    delisted_date: live ? null : (opts.valid_to ?? null),
  };
}

function alias(bw_sym_id: string, value: string, type: string, valid_to: string | null): Row {
  return { bw_sym_id, alias_type: type, alias_value: value, valid_to, confidence_score: 0.9 };
}

let SYMBOLS: Row[];
let SECURITY_MASTER: Row[];
let ALIASES: Row[];
let DAILY: Record<string, string[]> | null;

function resetFixtures() {
  SYMBOLS = [
    sym("BW-BBG000BWVSR1", "WM", { name: "Waste Management, Inc." }),
    sym("BW-BBG005H82GB2", "CC", { name: "Chemours Co." }),
    sym("BW-BBG000NDYB67", "GM", { name: "General Motors Company" }),
    sym("BW-BBG0065XPGX9", "WB", { name: "WEIBO Corp" }),
    // The former MF holder still has a (dead) registry row under its _OLD label.
    sym("BW-SSJAPHMGNNGW5", "MF_OLD", { dead: true }),
  ];
  SECURITY_MASTER = [
    sm("BW-BBG000BWVSR1", "WM", { name: "WASTE MANAGEMENT INC" }),
    sm("BW-BBG005H82GB2", "CC", { name: "Chemours Co" }),
    sm("BW-BBG000NDYB67", "GM", { name: "General Motors Co" }),
    sm("BW-BBG0065XPGX9", "WB", { name: "WEIBO Corp" }),
    sm("BW-BBG014Z5WMH8", "MF", { name: "MindForge Inc.", sector: "XLK", subsectors: '["IGV"]' }),
    sm("BW-BBG000C3GN47", "COG", {
      name: "COTERRA ENERGY INC",
      live: false,
      valid_to: "2026-03-31",
    }),
    sm("BW-S63JWQPX8101G", "COG", { unique: "COG#2", live: false, valid_to: "2021-12-03" }),
    sm("BW-BBG000BBQDH7", "BYON", { name: "BED BATH & BEYOND INC" }),
    sm("BW-BBG0087LHFY9", "BBBY_OLD", { live: false, valid_to: "2023-07-10" }),
  ];
  ALIASES = [
    alias("BW-BBG000BWVSR1", "WM", "TICKER", null),
    alias("BW-SJSY6F79CFDZ9", "WM", "LEGACY_TICKER", null),
    alias("BW-BBG005H82GB2", "CC", "TICKER", null),
    alias("BW-S57N44SR60YYW", "GM", "LEGACY_TICKER", "2011-03-31"),
    alias("BW-BBG000NDYB67", "GM", "TICKER", null),
    alias("BW-SSJAPHMGNNGW5", "MF", "TICKER", "2024-01-18"),
    alias("BW-BBG0065XPGX9", "WB", "TICKER", null),
    alias("BW-S0QGJVBGAXE65", "CTRA", "LEGACY_TICKER", "2021-02-08"),
    alias("BW-C0000886158", "BBBY", "LEGACY_TICKER", "2025-08-29"),
  ];
  DAILY = {
    WM: ["BW-BBG000BWVSR1"],
    CC: ["BW-BBG005H82GB2"],
    GM: ["BW-BBG000NDYB67"],
    GM_OLD: ["BW-BBG000BKGCP1"],
    WB: ["BW-BBG0065XPGX9"],
    WB_OLD: ["BW-SWJ6P4NFN986C", "BW-C0000036995"],
    MF: ["BW-BBG014Z5WMH8"],
    CTRA: ["BW-BBG000C3GN47"],
    COG: ["BW-BBG000C3GN47"],
    CTRA_OLD: ["BW-S0QGJVBGAXE65"],
    BBBY: ["BW-BBG000BBQDH7"],
    BYON: ["BW-BBG000BBQDH7"],
    BBBY_OLD: ["BW-BBG0087LHFY9"],
  };
}

function dailyIndex() {
  if (!DAILY) return null;
  const byTicker = new Map(Object.entries(DAILY));
  return { byTicker, symbols: new Set(Object.values(DAILY).flat()) };
}

const TICKER_ALIAS_TYPES = new Set(["TICKER", "EODHD_TICKER", "FINRA_TICKER"]);

/** Chainable, thenable Supabase stub filtering fixture tables by eq / in. */
function stubSupabase() {
  return {
    from(table: string) {
      const filters: { col: string; values: unknown[] }[] = [];
      let limit: number | null = null;
      const rowsFor = (): Row[] => {
        const base: Row[] =
          table === "symbols"
            ? SYMBOLS
            : table === "security_master"
              ? SECURITY_MASTER
              : table === "security_aliases"
                ? ALIASES
                : [];
        let rows = base.filter((r) =>
          filters.every((f) => f.values.includes(r[f.col] as unknown)),
        );
        if (table === "security_aliases") {
          rows = rows.filter((r) => TICKER_ALIAS_TYPES.has(String(r.alias_type)));
          // Mirror the DAL's ordering: open aliases first, then latest close.
          rows = [...rows].sort((a, b) => {
            const av = a.valid_to as string | null;
            const bv = b.valid_to as string | null;
            if (av === bv) return 0;
            if (av === null) return -1;
            if (bv === null) return 1;
            return av > bv ? -1 : 1;
          });
        }
        if (table === "symbols") {
          rows = [...rows].sort((a, b) => String(a.symbol).localeCompare(String(b.symbol)));
        }
        return limit === null ? rows : rows.slice(0, limit);
      };
      const query: Record<string, unknown> = {};
      query.select = () => query;
      query.eq = (col: string, v: unknown) => {
        filters.push({ col, values: [v] });
        return query;
      };
      query.in = (col: string, vs: unknown[]) => {
        // alias_type filter is applied in rowsFor; skip it here.
        if (!(table === "security_aliases" && col === "alias_type")) {
          filters.push({ col, values: vs });
        }
        return query;
      };
      query.is = () => query;
      query.ilike = () => query;
      query.or = () => query;
      query.order = () => query;
      query.limit = (n: number) => {
        limit = n;
        return query;
      };
      query.maybeSingle = async () => ({ data: rowsFor()[0] ?? null, error: null });
      (query as { then?: unknown }).then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: rowsFor(), error: null }).then(resolve);
      return query;
    },
  };
}

beforeEach(() => {
  resetFixtures();
  _resetClassProjectionsCache();
  vi.mocked(createAdminClient).mockReturnValue(stubSupabase() as never);
  vi.mocked(readDailyTickerHolderIndex).mockImplementation(async () => dailyIndex());
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://stub.local";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-key";
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("recycled tickers keep resolving to today's live company", () => {
  const LIVE: Record<string, string> = {
    WM: "BW-BBG000BWVSR1",
    CC: "BW-BBG005H82GB2",
    GM: "BW-BBG000NDYB67",
    WB: "BW-BBG0065XPGX9",
  };

  for (const [ticker, id] of Object.entries(LIVE)) {
    it(`${ticker} → live registry row ${id}, no fallback disclosure`, async () => {
      const rec = await resolveSymbolByTicker(ticker);
      expect(rec?.symbol).toBe(id);
      expect(rec?.ticker).toBe(ticker);
      expect(rec?.resolved_via).toBeUndefined();
      expect(rec?.delisted).toBeUndefined();
    });
  }

  it("MF → live MindForge (outside symbols) beats the former holder's closed alias + dead row", async () => {
    const rec = await resolveSymbolByTicker("MF");
    expect(rec).toMatchObject({
      symbol: "BW-BBG014Z5WMH8",
      ticker: "MF",
      name: "MindForge Inc.",
      sector_etf: "XLK",
      subsector_etf: "IGV",
      resolved_via: "most_recent_holder",
      delisted: false,
    });
  });

  it("live holder wins even when a dead identity shares the bare ticker in ds_daily", async () => {
    DAILY!.GM = ["BW-BBG000BKGCP1", "BW-BBG000NDYB67"];
    SECURITY_MASTER.push(sm("BW-BBG000BKGCP1", "GM", { live: false, valid_to: "2009-06-01" }));
    expect((await resolveSymbolByTicker("GM"))?.symbol).toBe("BW-BBG000NDYB67");
    // Even with the live symbols row gone, the holder pass still picks the live id.
    SYMBOLS = SYMBOLS.filter((r) => r.ticker !== "GM");
    expect((await resolveSymbolByTicker("GM"))?.symbol).toBe("BW-BBG000NDYB67");
  });
});

describe("delisted tickers resolve to their most recent holder", () => {
  it("CTRA → Coterra BW-BBG000C3GN47, flagged delisted", async () => {
    const rec = await resolveSymbolByTicker("ctra");
    expect(rec).toMatchObject({
      symbol: "BW-BBG000C3GN47",
      ticker: "CTRA",
      name: "COTERRA ENERGY INC",
      asset_type: "stock",
      resolved_via: "most_recent_holder",
      delisted: true,
    });
  });

  it("BBBY → BW-BBG000BBQDH7 (Overstock lineage), not the 2023 Bed Bath & Beyond", async () => {
    const rec = await resolveSymbolByTicker("BBBY");
    expect(rec).toMatchObject({
      symbol: "BW-BBG000BBQDH7",
      ticker: "BBBY",
      resolved_via: "most_recent_holder",
    });
    // security_master still marks the id active, so the flag follows the data.
    expect(rec?.delisted).toBe(false);
  });

  it("COG (Cabot → Coterra) picks the holder with the latest validity, not the 2021 id", async () => {
    const rec = await resolveSymbolByTicker("COG");
    expect(rec?.symbol).toBe("BW-BBG000C3GN47");
    expect(rec?.delisted).toBe(true);
  });

  it("batch resolver agrees with the single resolver", async () => {
    const tickers = ["WM", "CC", "GM", "MF", "WB", "CTRA", "BBBY", "NOPE"];
    const map = await resolveSymbolsByTickers(tickers);
    for (const t of tickers) {
      const single = await resolveSymbolByTicker(t);
      expect(map.get(t)?.symbol, t).toBe(single?.symbol);
      expect(map.get(t)?.resolved_via, t).toBe(single?.resolved_via);
      expect(map.get(t)?.delisted, t).toBe(single?.delisted);
    }
    expect(map.has("NOPE")).toBe(false);
  });

  it("an unknown ticker is still not found", async () => {
    expect(await resolveSymbolByTicker("NOPE")).toBeNull();
  });

  it("ds_daily unreadable: degrades to security_master-only candidates, never throws", async () => {
    DAILY = null;
    expect(await resolveSymbolByTicker("CTRA")).toBeNull();
    expect((await resolveSymbolByTicker("MF"))?.symbol).toBe("BW-BBG014Z5WMH8");
  });

  it("a live holder with no history here answers not-found, never a former holder", async () => {
    // MindForge leaves ds_daily: its live claim on MF must still block the
    // former holder's dead registry row.
    DAILY!.MF = [];
    SYMBOLS.push(sym("BW-SSJAPHMGNNGW5-B", "MF", { dead: true }));
    expect(await resolveSymbolByTicker("MF")).toBeNull();
    expect((await resolveSymbolsByTickers(["MF"])).has("MF")).toBe(false);
  });

  it("a dead-only registry row with no other holder still answers (flagged)", async () => {
    SYMBOLS.push(sym("BW-DEAD-ONLY", "DEAD", { dead: true }));
    const rec = await resolveSymbolByTicker("DEAD");
    expect(rec).toMatchObject({ symbol: "BW-DEAD-ONLY", ticker: "DEAD", delisted: true });
  });

  it("today's production ds_daily (BBQDH7 still labelled BYON) leaves BBBY unresolved", async () => {
    delete DAILY!.BBBY;
    expect(await resolveSymbolByTicker("BBBY")).toBeNull();
  });
});

describe("rankHolderCandidates", () => {
  const c = (id: string, live: boolean, held: string | null, daily: boolean | null = true) => ({
    bw_sym_id: id,
    live,
    held_through: held,
    in_daily_store: daily,
  });

  it("live beats any former holder, then latest held_through, then ds_daily presence, then id", () => {
    expect(rankHolderCandidates([c("A", false, "2026-09-01"), c("B", true, null)])?.bw_sym_id).toBe("B");
    expect(rankHolderCandidates([c("A", false, "2021-01-01"), c("B", false, "2026-03-31")])?.bw_sym_id).toBe("B");
    expect(rankHolderCandidates([c("A", false, null), c("B", false, "2001-01-01")])?.bw_sym_id).toBe("B");
    expect(rankHolderCandidates([c("A", false, "2020-01-01", false), c("B", false, "2020-01-01", true)])?.bw_sym_id).toBe("B");
    expect(rankHolderCandidates([c("B", true, null), c("A", true, null)])?.bw_sym_id).toBe("A");
    expect(rankHolderCandidates([])).toBeNull();
  });
});

describe("search and registry routes surface the fallback", () => {
  it("searchTickers leads with the delisted holder for an exact ticker query", async () => {
    const rows = await searchTickers("CTRA");
    expect(rows[0]).toMatchObject({
      ticker: "CTRA",
      name: "COTERRA ENERGY INC",
      resolved_via: "most_recent_holder",
      delisted: true,
    });
    // Never leaks the internal bw_sym_id as the search row's symbol.
    expect(rows[0]?.symbol).toBe("CTRA");
  });

  it("searchTickers leaves live tickers alone", async () => {
    const rows = await searchTickers("WM");
    expect(rows.every((r) => r.resolved_via === undefined)).toBe(true);
  });

  it("GET /api/data/symbols/CTRA answers 200 with the disclosure; NOPE still 404s", async () => {
    const res = await getSymbol(new Request("http://test") as never, {
      params: Promise.resolve({ ticker: "CTRA" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      symbol: "BW-BBG000C3GN47",
      ticker: "CTRA",
      requested_ticker: "CTRA",
      resolved_via: "most_recent_holder",
      delisted: true,
    });
    const miss = await getSymbol(new Request("http://test") as never, {
      params: Promise.resolve({ ticker: "NOPE" }),
    });
    expect(miss.status).toBe(404);
  });
});
