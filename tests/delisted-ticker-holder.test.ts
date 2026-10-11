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
import { POST as postSymbolsBatch } from "@/app/api/data/symbols/batch/route";
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
/** ds_daily display `ticker` coord (null = store unreadable). */
let DAILY: Record<string, string[]> | null;
/** ds_daily `unique_ticker` labels (recall only). */
let DAILY_UNIQUE: Record<string, string[]>;
/** ds_daily `eodhd_code` minus ".US" (recall only; the last listing). */
let DAILY_LISTING: Record<string, string[]>;
/** security_master requests whose `.in()` values include any of these fail. */
let SM_FAIL_KEYS: Set<string>;
/** security_master responses report one row more than they return. */
let SM_TRUNCATE: boolean;

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
    CTRA_OLD: ["BW-S0QGJVBGAXE65"],
    // Today's store: BBQDH7 still displayed as BYON.
    BYON: ["BW-BBG000BBQDH7"],
    BBBY_OLD: ["BW-BBG0087LHFY9"],
  };
  DAILY_UNIQUE = {
    // Coterra's unique_ticker is its pre-2021 symbol.
    COG: ["BW-BBG000C3GN47"],
  };
  DAILY_LISTING = {
    CTRA: ["BW-BBG000C3GN47"],
    // Post-pin eodhd_code BBBY.US (ERM3 listing_code_pins republish).
    BBBY: ["BW-BBG000BBQDH7"],
  };
  SM_FAIL_KEYS = new Set();
  SM_TRUNCATE = false;
}

function dailyIndex() {
  if (!DAILY) return null;
  const byTicker = new Map<string, string[]>();
  for (const src of [DAILY, DAILY_UNIQUE, DAILY_LISTING]) {
    for (const [t, ids] of Object.entries(src)) {
      byTicker.set(t, [...new Set([...(byTicker.get(t) ?? []), ...ids])]);
    }
  }
  return {
    byTicker,
    byDisplayTicker: new Map(Object.entries(DAILY)),
    byListingTicker: new Map(Object.entries(DAILY_LISTING)),
    symbols: new Set(
      [...Object.values(DAILY), ...Object.values(DAILY_UNIQUE), ...Object.values(DAILY_LISTING)].flat(),
    ),
    complete: true,
  };
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
      const respond = () => {
        const rows = rowsFor();
        if (table === "security_master") {
          if (filters.some((f) => f.values.some((v) => SM_FAIL_KEYS.has(String(v))))) {
            return { data: null, error: { message: "stub outage" }, count: null };
          }
          return { data: rows, error: null, count: rows.length + (SM_TRUNCATE ? 1 : 0) };
        }
        return { data: rows, error: null, count: rows.length };
      };
      (query as { then?: unknown }).then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve(respond()).then(resolve);
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

  it("ds_daily unreadable: no new answers, and the live MF holder still blocks the former one", async () => {
    DAILY = null;
    expect(await resolveSymbolByTicker("CTRA")).toBeNull();
    // MindForge's history cannot be confirmed, so MF is not found — never the
    // former holder's dead registry row that main used to serve.
    expect(await resolveSymbolByTicker("MF")).toBeNull();
    expect((await resolveSymbolsByTickers(["MF", "CTRA"])).size).toBe(0);
  });

  it("a live holder with no history here answers not-found, never a former holder", async () => {
    // MindForge leaves ds_daily: its live claim on MF must still block the
    // former holder's dead registry row.
    DAILY!.MF = [];
    SYMBOLS.push(sym("BW-SSJAPHMGNNGW5-B", "MF", { dead: true }));
    expect(await resolveSymbolByTicker("MF")).toBeNull();
    expect((await resolveSymbolsByTickers(["MF"])).has("MF")).toBe(false);
  });

  it("a dead-only registry row with no other holder still answers, unchanged from main", async () => {
    SYMBOLS.push(sym("BW-DEAD-ONLY", "DEAD", { dead: true }));
    const rec = await resolveSymbolByTicker("DEAD");
    expect(rec).toMatchObject({ symbol: "BW-DEAD-ONLY", ticker: "DEAD" });
    expect(rec?.resolved_via).toBeUndefined();
    expect(rec?.delisted).toBeUndefined();
  });

  it("today's production ds_daily (BBQDH7 still labelled BYON) leaves BBBY unresolved", async () => {
    delete DAILY_LISTING.BBBY;
    expect(await resolveSymbolByTicker("BBBY")).toBeNull();
  });
});

describe("adversarial holder cases (Grok reviews, 2026-10-10)", () => {
  async function both(t: string) {
    const single = await resolveSymbolByTicker(t);
    const batch = (await resolveSymbolsByTickers([t])).get(t) ?? null;
    expect(batch?.symbol ?? null, `batch ${t}`).toBe(single?.symbol ?? null);
    expect(batch?.resolved_via, `batch resolved_via ${t}`).toBe(single?.resolved_via);
    expect(batch?.delisted, `batch delisted ${t}`).toBe(single?.delisted);
    return single;
  }

  it("a live id linked only by a stale recall label is not the holder, and its other closed rows do not move held_through", async () => {
    // L is live under LIVEX; its stale unique_ticker says FOO; it also has a
    // closed row for a third ticker ending 2026-01-01. D held FOO to 2025-06-30.
    SECURITY_MASTER.push(sm("BW-L", "LIVEX", { unique: "FOO" }));
    SECURITY_MASTER.push(sm("BW-L", "OTHER", { live: false, valid_to: "2026-01-01" }));
    SECURITY_MASTER.push(sm("BW-D", "FOO", { live: false, valid_to: "2025-06-30" }));
    DAILY!.LIVEX = ["BW-L"];
    DAILY!.FOO_OLD = ["BW-D"];
    DAILY_UNIQUE.FOO = ["BW-L"];
    const rec = await both("FOO");
    expect(rec).toMatchObject({ symbol: "BW-D", ticker: "FOO", delisted: true });
  });

  it("a display coord lagging a rename never elects the renamed id over the security_master holder", async () => {
    // B renamed OLD → NEW (security_master), ds_daily display still OLD.
    // A holds OLD per security_master but has no ds_daily history.
    SECURITY_MASTER.push(sm("BW-B", "NEW"));
    SECURITY_MASTER.push(sm("BW-A", "OLD"));
    DAILY!.OLD = ["BW-B"];
    expect(await both("OLD")).toBeNull();
  });

  it("a closed alias on the open security_master holder does not demote it below an older dead id", async () => {
    SECURITY_MASTER.push(sm("BW-X", "REQ"));
    SECURITY_MASTER.push(sm("BW-Y", "REQ", { live: false, valid_to: "2025-08-29" }));
    ALIASES.push(alias("BW-X", "REQ", "TICKER", "2024-01-01"));
    DAILY!.REQX = ["BW-X"];
    DAILY!.REQ_OLD = ["BW-Y"];
    const rec = await both("REQ");
    expect(rec).toMatchObject({ symbol: "BW-X", ticker: "REQ", delisted: false });
  });

  it("a ticker that resolved before keeps its identity, unflagged, unless a LIVE holder exists", async () => {
    SYMBOLS.push(sym("BW-A", "STK", { dead: true }));
    SECURITY_MASTER.push(sm("BW-B", "STK", { live: false, valid_to: "2026-01-01" }));
    DAILY!.STK = ["BW-B"];
    const rec = await both("STK");
    expect(rec).toMatchObject({ symbol: "BW-A", ticker: "STK" });
    expect(rec?.resolved_via).toBeUndefined();
  });

  it("security_master outage: no new holder, previous answers kept unchanged", async () => {
    SM_FAIL_KEYS = new Set(["CTRA", "DEAD", "BW-BBG000C3GN47", "BW-DEAD-ONLY"]);
    SYMBOLS.push(sym("BW-DEAD-ONLY", "DEAD", { dead: true }));
    expect(await both("CTRA")).toBeNull();
    const dead = await both("DEAD");
    expect(dead).toMatchObject({ symbol: "BW-DEAD-ONLY" });
    expect(dead?.resolved_via).toBeUndefined();
    // Live symbols rows never touch the holder pass.
    expect((await both("WM"))?.symbol).toBe("BW-BBG000BWVSR1");
  });

  it("one failing key fails only its ticker: batch == single", async () => {
    SM_FAIL_KEYS = new Set(["FAT"]);
    const map = await resolveSymbolsByTickers(["CTRA", "FAT"]);
    expect(map.get("CTRA")?.symbol).toBe("BW-BBG000C3GN47");
    expect(map.has("FAT")).toBe(false);
    expect((await resolveSymbolByTicker("CTRA"))?.symbol).toBe("BW-BBG000C3GN47");
  });

  it("a security_master response shorter than its exact count fails closed", async () => {
    SM_TRUNCATE = true;
    expect(await both("CTRA")).toBeNull();
  });

  it("six registry rows for one ticker, live row last by id: single and batch both return it", async () => {
    for (let i = 0; i < 5; i++) SYMBOLS.push(sym(`BW-A${i}`, "SIX", { dead: true }));
    SYMBOLS.push(sym("BW-Z-LIVE", "SIX"));
    const rec = await both("SIX");
    expect(rec?.symbol).toBe("BW-Z-LIVE");
    expect(rec?.resolved_via).toBeUndefined();
  });

  it("FB: a closed alias still answers META (unchanged) until another security holds FB; then live wins", async () => {
    // Production 2026-10-10: alias FB → BW-BBG000MM2P62 (META) closed 2022-06-09;
    // security_master BW-BBG01VRMNFB1 (ProShares ETF) holds FB since 2025-10-01,
    // outside ds_daily.
    SYMBOLS.push(sym("BW-BBG000MM2P62", "META", { name: "Meta Platforms" }));
    SECURITY_MASTER.push(sm("BW-BBG000MM2P62", "META"));
    ALIASES.push(alias("BW-BBG000MM2P62", "FB", "EODHD_TICKER", "2022-06-09"));
    DAILY!.META = ["BW-BBG000MM2P62"];
    const meta = await both("FB");
    expect(meta).toMatchObject({ symbol: "BW-BBG000MM2P62", ticker: "FB" });
    expect(meta?.resolved_via).toBeUndefined();
    SECURITY_MASTER.push(sm("BW-BBG01VRMNFB1", "FB", { name: "PROSHARES TR" }));
    expect(await both("FB")).toBeNull();
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

  it("GET /api/data/symbols/MF swaps a dead registry row for the live holder, as the DAL does", async () => {
    SYMBOLS.push(sym("BW-OLD-MF", "MF", { dead: true }));
    const res = await getSymbol(new Request("http://test") as never, {
      params: Promise.resolve({ ticker: "MF" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      symbol: "BW-BBG014Z5WMH8",
      resolved_via: "most_recent_holder",
      delisted: false,
    });
    expect((await resolveSymbolByTicker("MF"))?.symbol).toBe("BW-BBG014Z5WMH8");
  });

  it("POST /api/data/symbols/batch: live rows untouched, dead row kept, delisted holder added", async () => {
    SYMBOLS.push(sym("BW-DEAD-ONLY", "DEAD", { dead: true }));
    const res = await postSymbolsBatch(
      new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ tickers: ["WM", "DEAD", "CTRA", "NOPE"] }),
      }) as never,
    );
    const body = (await res.json()) as { results: Record<string, Record<string, unknown>> };
    expect(body.results.WM).toMatchObject({ symbol: "BW-BBG000BWVSR1" });
    expect(body.results.WM?.resolved_via).toBeUndefined();
    expect(body.results.DEAD).toMatchObject({ symbol: "BW-DEAD-ONLY" });
    expect(body.results.DEAD?.resolved_via).toBeUndefined();
    expect(body.results.CTRA).toMatchObject({ symbol: "BW-BBG000C3GN47", delisted: true });
    expect(body.results.NOPE).toBeUndefined();
  });
});
