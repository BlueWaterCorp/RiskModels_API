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
import { _resetHolderCache, rankHolderCandidates } from "@/lib/dal/ticker-holder";
import { indexFromCoords } from "@/lib/dal/daily-ticker-index";
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
/** symbols requests whose `.in()` values include any of these fail. */
let SYM_FAIL_KEYS: Set<string>;
/** symbols `.in()` responses report one row more than they return. */
let SYM_TRUNCATE: boolean;
/** security_aliases reads fail. */
let ALIAS_FAIL: boolean;
/** symbols queries throw (client / network failure). */
let SYM_THROW: boolean;

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
  SYM_FAIL_KEYS = new Set();
  SYM_TRUNCATE = false;
  ALIAS_FAIL = false;
  SYM_THROW = false;
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
          // Mirror the SQL order: valid_to DESC NULLS FIRST, confidence_score
          // DESC NULLS FIRST, bw_sym_id ASC.
          rows = [...rows].sort((a, b) => {
            const av = a.valid_to as string | null;
            const bv = b.valid_to as string | null;
            if (av !== bv) {
              if (av === null) return -1;
              if (bv === null) return 1;
              return av > bv ? -1 : 1;
            }
            const ac = (a.confidence_score as number | null) ?? Number.POSITIVE_INFINITY;
            const bc = (b.confidence_score as number | null) ?? Number.POSITIVE_INFINITY;
            if (ac !== bc) return bc - ac;
            return String(a.bw_sym_id).localeCompare(String(b.bw_sym_id));
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
      query.maybeSingle = async () =>
        (table === "symbols" && filters.some((f) => f.values.some((v) => SYM_FAIL_KEYS.has(String(v))))) ||
        (table === "security_aliases" && ALIAS_FAIL)
          ? { data: null, error: { message: "stub outage" } }
          : { data: rowsFor()[0] ?? null, error: null };
      const respond = () => {
        const rows = rowsFor();
        if (table === "security_master") {
          if (filters.some((f) => f.values.some((v) => SM_FAIL_KEYS.has(String(v))))) {
            return { data: null, error: { message: "stub outage" }, count: null };
          }
          return { data: rows, error: null, count: rows.length + (SM_TRUNCATE ? 1 : 0) };
        }
        if (table === "security_aliases" && ALIAS_FAIL) {
          return { data: null, error: { message: "stub outage" }, count: null };
        }
        if (table === "symbols") {
          if (filters.some((f) => f.values.some((v) => SYM_FAIL_KEYS.has(String(v))))) {
            return { data: null, error: { message: "stub outage" }, count: null };
          }
          if (SYM_TRUNCATE) return { data: rows, error: null, count: rows.length + 1 };
        }
        return { data: rows, error: null, count: rows.length };
      };
      (query as { then?: unknown }).then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        table === "symbols" && SYM_THROW
          ? Promise.reject(new Error("stub network failure")).then(resolve, reject)
          : Promise.resolve(respond()).then(resolve);
      return query;
    },
  };
}

beforeEach(() => {
  resetFixtures();
  _resetClassProjectionsCache();
  vi.mocked(createAdminClient).mockReturnValue(stubSupabase() as never);
  vi.mocked(readDailyTickerHolderIndex).mockImplementation(async () => dailyIndex());
  // Fixtures change inside tests; the per-instance holder cache is tested on its own.
  process.env.TICKER_HOLDER_CACHE_TTL_MS = "0";
  _resetHolderCache();
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

  it("BBBY → BW-BBG000BBQDH7 when ds_daily prices it under BBBY on display and listing code", async () => {
    // Production 2026-10-11 after the ERM3 republish: display BBBY, eodhd_code
    // BBBY.US, unique_ticker BYON; security_master still says BYON (open).
    DAILY!.BBBY = ["BW-BBG000BBQDH7"];
    const rec = await resolveSymbolByTicker("BBBY");
    expect(rec).toMatchObject({
      symbol: "BW-BBG000BBQDH7",
      ticker: "BBBY",
      resolved_via: "most_recent_holder",
      delisted: false,
    });
    // One label alone (listing code only) does not serve an open identity.
    delete DAILY!.BBBY;
    expect(await resolveSymbolByTicker("BBBY")).toBeNull();
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

  it("ds_daily unreadable: no new answers; MF keeps main's answer (the former holder's alias row)", async () => {
    DAILY = null;
    expect(await resolveSymbolByTicker("CTRA")).toBeNull();
    const mf = await resolveSymbolByTicker("MF");
    // main's alias row; its registry row is flagged dead, so delisted: true.
    expect(mf).toMatchObject({ symbol: "BW-SSJAPHMGNNGW5", ticker: "MF", delisted: true });
    expect(mf?.resolved_via).toBeUndefined();
    const map = await resolveSymbolsByTickers(["MF", "CTRA"]);
    expect(map.get("MF")?.symbol).toBe("BW-SSJAPHMGNNGW5");
    expect(map.has("CTRA")).toBe(false);
  });

  it("a live holder the API cannot serve does not veto the previous answer; with none, not found", async () => {
    // MindForge leaves ds_daily: main's answer (a dead MF registry row) stays.
    DAILY!.MF = [];
    SYMBOLS.push(sym("BW-SSJAPHMGNNGW5-B", "MF", { dead: true }));
    const kept = {
      symbol: "BW-SSJAPHMGNNGW5-B",
      delisted: true,
      // ...but the response says the ticker now belongs to MindForge.
      ticker_reassigned: true,
      current_holder: { symbol: "BW-BBG014Z5WMH8", name: "MindForge Inc." },
    };
    expect(await resolveSymbolByTicker("MF")).toMatchObject(kept);
    expect((await resolveSymbolsByTickers(["MF"])).get("MF")).toMatchObject(kept);
    // No previous answer at all: not found, never a synthetic row.
    SYMBOLS = SYMBOLS.filter((r) => r.ticker !== "MF");
    ALIASES = ALIASES.filter((r) => r.alias_value !== "MF");
    expect(await resolveSymbolByTicker("MF")).toBeNull();
    expect((await resolveSymbolsByTickers(["MF"])).has("MF")).toBe(false);
  });

  it("a dead-only registry row with no other holder still answers as on main, plus delisted: true", async () => {
    SYMBOLS.push(sym("BW-DEAD-ONLY", "DEAD", { dead: true }));
    const rec = await resolveSymbolByTicker("DEAD");
    expect(rec).toMatchObject({ symbol: "BW-DEAD-ONLY", ticker: "DEAD", delisted: true });
    expect(rec?.resolved_via).toBeUndefined();
    expect(rec?.ticker_reassigned).toBeUndefined();
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
    expect(batch?.ticker, `batch ticker ${t}`).toBe(single?.ticker);
    expect(batch?.ticker_reassigned, `batch ticker_reassigned ${t}`).toBe(single?.ticker_reassigned);
    expect(batch?.current_holder, `batch current_holder ${t}`).toEqual(single?.current_holder);
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
    expect(rec).toMatchObject({ symbol: "BW-A", ticker: "STK", delisted: true });
    expect(rec?.resolved_via).toBeUndefined();
  });

  it("security_master outage: no new holder, previous answers kept unchanged", async () => {
    SM_FAIL_KEYS = new Set(["CTRA", "DEAD", "BW-BBG000C3GN47", "BW-DEAD-ONLY"]);
    SYMBOLS.push(sym("BW-DEAD-ONLY", "DEAD", { dead: true }));
    expect(await both("CTRA")).toBeNull();
    const dead = await both("DEAD");
    // main's answer, marked as unchecked.
    expect(dead).toMatchObject({ symbol: "BW-DEAD-ONLY", delisted: true, resolution_degraded: true });
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

  it("a dead id whose ds_daily label lags a rename cannot stretch its old window with a later row", async () => {
    // B held OLD to 2019, then NEW to 2024 (dead); ds_daily still labels it OLD.
    // A held OLD to 2022. A is the most recent holder of OLD.
    SECURITY_MASTER.push(sm("BW-LAG-B", "OLD", { live: false, valid_to: "2019-01-01" }));
    SECURITY_MASTER.push(sm("BW-LAG-B", "NEW", { live: false, valid_to: "2024-01-01" }));
    SECURITY_MASTER.push(sm("BW-LAG-A", "OLD", { live: false, valid_to: "2022-01-01" }));
    DAILY!.OLD = ["BW-LAG-B"];
    DAILY!.OLD_A = ["BW-LAG-A"];
    expect((await both("OLD"))?.symbol).toBe("BW-LAG-A");
  });

  it("an alias registry row that cannot be read never lets a former holder stand in", async () => {
    // FB → META alias; reading META's row fails; a dead former FB holder exists.
    SYMBOLS.push(sym("BW-BBG000MM2P62", "META"));
    ALIASES.push(alias("BW-BBG000MM2P62", "FB", "EODHD_TICKER", "2022-06-09"));
    // A dated former FB holder that would outrank the alias candidate.
    SECURITY_MASTER.push(sm("BW-OLD-FB", "FB", { live: false, valid_to: "2025-01-01" }));
    DAILY!.FB_OLD = ["BW-OLD-FB"];
    expect((await both("FB"))?.symbol).toBe("BW-BBG000MM2P62");
    SYM_FAIL_KEYS = new Set(["BW-BBG000MM2P62"]);
    expect(await both("FB")).toBeNull();
  });

  it("a holder whose registry row is flagged dead under another ticker is not live", async () => {
    SYMBOLS.push(sym("BW-DEADREG", "RENAMED", { dead: true }));
    SECURITY_MASTER.push(sm("BW-DEADREG", "TDR"));
    DAILY!.RENAMED = ["BW-DEADREG"];
    expect(await both("TDR")).toBeNull();
    // Vetoed before ranking, so a dated former holder still answers.
    SECURITY_MASTER.push(sm("BW-TDR-A", "TDR", { live: false, valid_to: "2024-01-01" }));
    DAILY!.TDR_A = ["BW-TDR-A"];
    expect(await both("TDR")).toMatchObject({ symbol: "BW-TDR-A", delisted: true });
    // ...and a second, servable live holder wins over the vetoed one.
    SYMBOLS.push(sym("BW-TDR-C", "TDRC"));
    SECURITY_MASTER.push(sm("BW-TDR-C", "TDR"));
    DAILY!.TDRC = ["BW-TDR-C"];
    expect(await both("TDR")).toMatchObject({ symbol: "BW-TDR-C", delisted: false });
  });

  it("an open identity renamed in place is never served for its old display label", async () => {
    SECURITY_MASTER.push(sm("BW-INPLACE", "NEWT"));
    DAILY!.OLDT = ["BW-INPLACE"];
    expect(await both("OLDT")).toBeNull();
  });

  it("a dead identity renamed in place loses to a T-dated holder", async () => {
    SECURITY_MASTER.push(sm("BW-IP-B", "NEWD", { live: false, valid_to: "2024-06-01" }));
    SECURITY_MASTER.push(sm("BW-IP-A", "OLDD", { live: false, valid_to: "2023-01-01" }));
    DAILY!.OLDD = ["BW-IP-B"];
    DAILY!.OLDD_A = ["BW-IP-A"];
    expect((await both("OLDD"))?.symbol).toBe("BW-IP-A");
  });

  it("security_aliases or the registry read failing yields not-found, never a former holder", async () => {
    SECURITY_MASTER.push(sm("BW-OLD-FB", "FB", { live: false, valid_to: "2010-01-01" }));
    DAILY!.FB_OLD = ["BW-OLD-FB"];
    expect((await both("FB"))?.symbol).toBe("BW-OLD-FB");
    ALIAS_FAIL = true;
    expect(await both("FB")).toBeNull();
    ALIAS_FAIL = false;
    SYM_FAIL_KEYS = new Set(["FB"]);
    expect(await both("FB")).toBeNull();
  });

  it("a registry read that throws fails closed in both resolvers", async () => {
    SECURITY_MASTER.push(sm("BW-OLD-WM", "WM", { live: false, valid_to: "2001-01-01" }));
    DAILY!.WM_OLD = ["BW-OLD-WM"];
    SYM_THROW = true;
    expect(await both("WM")).toBeNull();
    SYM_THROW = false;
  });

  it("an unreadable ds_daily index never sets ticker_reassigned", async () => {
    SYMBOLS.push(sym("BW-BBG000MM2P62", "META"));
    ALIASES.push(alias("BW-BBG000MM2P62", "FB", "EODHD_TICKER", "2022-06-09"));
    SECURITY_MASTER.push(sm("BW-BBG01VRMNFB1", "FB", { name: "PROSHARES TR" }));
    DAILY = null;
    const rec = await both("FB");
    expect(rec?.symbol).toBe("BW-BBG000MM2P62");
    expect(rec?.ticker_reassigned).toBeUndefined();
  });

  it("among undated candidates, display + listing evidence beats a single stale label", async () => {
    // BW-A (lower id) is dead, linked only by its display label; BW-Z is open
    // and priced under ZZ on display and listing code. Neither is dated.
    SECURITY_MASTER.push(sm("BW-A-ZZ", "OTHERA", { live: false, valid_to: "2020-01-01" }));
    SECURITY_MASTER.push(sm("BW-Z-ZZ", "OTHERZ"));
    DAILY!.ZZ = ["BW-A-ZZ", "BW-Z-ZZ"];
    DAILY_LISTING.ZZ = ["BW-Z-ZZ"];
    expect((await both("ZZ"))?.symbol).toBe("BW-Z-ZZ");
  });

  it("a share-class canonical whose registry read fails yields not-found, never a former holder", async () => {
    SYMBOLS.push(sym("BW-BBG009S3NB30", "GOOG"));
    SECURITY_MASTER.push(sm("BW-OLD-GOOGL", "GOOGL", { live: false, valid_to: "2015-01-01" }));
    DAILY!.GOOGL_OLD = ["BW-OLD-GOOGL"];
    expect((await both("GOOGL"))?.symbol).toBe("BW-BBG009S3NB30");
    SYM_FAIL_KEYS = new Set(["GOOG"]);
    expect(await both("GOOGL")).toBeNull();
  });

  it("both resolvers pick the same alias on equal windows (null confidence first, then id)", async () => {
    SYMBOLS.push(sym("BW-AL-1", "AL1"), sym("BW-AL-2", "AL2"));
    ALIASES.push({ bw_sym_id: "BW-AL-2", alias_type: "TICKER", alias_value: "ALQ", valid_to: null, confidence_score: 0.9 });
    ALIASES.push({ bw_sym_id: "BW-AL-1", alias_type: "TICKER", alias_value: "ALQ", valid_to: null, confidence_score: null });
    expect((await both("ALQ"))?.symbol).toBe("BW-AL-1");
  });

  it("security_master rows that differ only in status are both kept (an open copy stays open)", async () => {
    SECURITY_MASTER.push({ ...sm("BW-DUP", "DUPT"), is_active: false });
    SECURITY_MASTER.push(sm("BW-DUP", "DUPT"));
    DAILY!.DUPX = ["BW-DUP"];
    expect(await both("DUPT")).toMatchObject({ symbol: "BW-DUP", delisted: false });
  });

  it("every dead registry row is vetoed, not only the pick", async () => {
    // Two dead rows for VET; security_master says the second is open under VET.
    SYMBOLS.push(sym("BW-VET-A", "VET", { dead: true }));
    SYMBOLS.push(sym("BW-VET-B", "VET", { dead: true }));
    SECURITY_MASTER.push(sm("BW-VET-B", "VET"));
    DAILY!.VET = ["BW-VET-B"];
    const rec = await both("VET");
    expect(rec).toMatchObject({ symbol: "BW-VET-A", delisted: true });
    expect(rec?.resolved_via).toBeUndefined();
  });

  it("registry reads that error or come back short drop only their tickers", async () => {
    SYM_FAIL_KEYS = new Set(["CTRA"]);
    const map = await resolveSymbolsByTickers(["CTRA", "WM"]);
    // The shared chunk fails; the per-key retry recovers WM, CTRA stays unread.
    expect(map.get("WM")?.symbol).toBe("BW-BBG000BWVSR1");
    expect(map.has("CTRA")).toBe(false);
    expect(await resolveSymbolByTicker("CTRA")).toBeNull();
    SYM_FAIL_KEYS = new Set(["BW-BBG000C3GN47"]);
    // Holder symbols read for Coterra's id fails: CTRA stays unanswered, WM fine.
    const map2 = await resolveSymbolsByTickers(["CTRA", "WM"]);
    expect(map2.has("CTRA")).toBe(false);
    expect(map2.get("WM")?.symbol).toBe("BW-BBG000BWVSR1");
    SYM_FAIL_KEYS = new Set();
    SYM_TRUNCATE = true;
    expect((await resolveSymbolsByTickers(["WM"])).size).toBe(0);
  });

  it("six registry rows for one ticker, live row last by id: single and batch both return it", async () => {
    for (let i = 0; i < 5; i++) SYMBOLS.push(sym(`BW-A${i}`, "SIX", { dead: true }));
    SYMBOLS.push(sym("BW-Z-LIVE", "SIX"));
    const rec = await both("SIX");
    expect(rec?.symbol).toBe("BW-Z-LIVE");
    expect(rec?.resolved_via).toBeUndefined();
  });

  it("FB: a closed alias answers META (unchanged) until a live FB holder can be served", async () => {
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
    // The ProShares holder cannot be served here: META stays (main's answer)
    // and the response discloses that FB now belongs to someone else.
    SECURITY_MASTER.push(sm("BW-BBG01VRMNFB1", "FB", { name: "PROSHARES TR" }));
    const kept = await both("FB");
    expect(kept).toMatchObject({
      symbol: "BW-BBG000MM2P62",
      ticker_reassigned: true,
      current_holder: { symbol: "BW-BBG01VRMNFB1", name: "PROSHARES TR" },
    });
    expect(kept?.resolved_via).toBeUndefined();
    expect(kept?.delisted).toBeUndefined();
    expect((await searchTickers("FB"))[0]).toMatchObject({
      ticker: "FB",
      ticker_reassigned: true,
      current_holder: { symbol: "BW-BBG01VRMNFB1" },
    });
    // Once ds_daily carries it, the live holder wins.
    DAILY!.FB = ["BW-BBG01VRMNFB1"];
    expect(await both("FB")).toMatchObject({
      symbol: "BW-BBG01VRMNFB1",
      resolved_via: "most_recent_holder",
      delisted: false,
    });
  });

  it("a security_master row naming the ticker outranks an open id linked only by a ds_daily label", async () => {
    // The listing label may lag a rename, so it never beats T-dated evidence.
    // Production has no security_master row with ticker BBBY, so post-pin
    // BBBY still resolves to BBQDH7 (test above).
    SECURITY_MASTER.push(sm("BW-OLD-BBBY", "BBBY", { live: false, valid_to: "2023-07-10" }));
    DAILY!.BBBY_X = ["BW-OLD-BBBY"];
    expect((await both("BBBY"))?.symbol).toBe("BW-OLD-BBBY");
  });

  it("a servable live holder with a registry row under another ticker is served, relabelled", async () => {
    SYMBOLS.push(sym("BW-LIVE-REG", "RENAMED"));
    SECURITY_MASTER.push(sm("BW-LIVE-REG", "RTK"));
    ALIASES.push(alias("BW-OLD-RTK", "RTK", "TICKER", "2020-01-01"));
    SYMBOLS.push(sym("BW-OLD-RTK", "RTK_OLD", { dead: true }));
    DAILY!.RENAMED = ["BW-LIVE-REG"];
    expect(await both("RTK")).toMatchObject({
      symbol: "BW-LIVE-REG",
      ticker: "RTK",
      modelled_ticker: "RENAMED",
      resolved_via: "most_recent_holder",
      delisted: false,
    });
  });

  it("an open alias does not beat a servable live holder", async () => {
    SYMBOLS.push(sym("BW-ALIAS-A", "AOLD"));
    ALIASES.push(alias("BW-ALIAS-A", "OPN", "TICKER", null));
    SECURITY_MASTER.push(sm("BW-LIVE-B", "OPN"));
    DAILY!.OPN = ["BW-LIVE-B"];
    expect(await both("OPN")).toMatchObject({ symbol: "BW-LIVE-B", resolved_via: "most_recent_holder" });
    // Without a live holder the open alias answers as before.
    SECURITY_MASTER = SECURITY_MASTER.filter((r) => r.bw_sym_id !== "BW-LIVE-B");
    const aliasAnswer = await both("OPN");
    expect(aliasAnswer?.symbol).toBe("BW-ALIAS-A");
    expect(aliasAnswer?.resolved_via).toBeUndefined();
    expect(aliasAnswer?.delisted).toBeUndefined();
  });

  it("51 registry rows, live row last by id: single and batch agree", async () => {
    for (let i = 0; i < 50; i++) SYMBOLS.push(sym(`BW-A${String(i).padStart(2, "0")}`, "MANY", { dead: true }));
    SYMBOLS.push(sym("BW-Z-LIVE", "MANY"));
    expect((await both("MANY"))?.symbol).toBe("BW-Z-LIVE");
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
    expect(body.results.DEAD).toMatchObject({ symbol: "BW-DEAD-ONLY", delisted: true });
    expect(body.results.DEAD?.resolved_via).toBeUndefined();
    expect(body.results.CTRA).toMatchObject({
      symbol: "BW-BBG000C3GN47",
      delisted: true,
      requested_ticker: "CTRA",
      is_modelled_class: true,
    });
    expect(body.results.NOPE).toBeUndefined();
  });
});

describe("per-instance holder cache", () => {
  it("serves a repeated miss from cache within the TTL; failed lookups are not cached", async () => {
    process.env.TICKER_HOLDER_CACHE_TTL_MS = "60000";
    _resetHolderCache();
    expect((await resolveSymbolByTicker("CTRA"))?.symbol).toBe("BW-BBG000C3GN47");
    // The holder disappears from every source; the cached decision still answers.
    DAILY = {};
    DAILY_LISTING = {};
    expect((await resolveSymbolByTicker("CTRA"))?.symbol).toBe("BW-BBG000C3GN47");
    _resetHolderCache();
    expect(await resolveSymbolByTicker("CTRA")).toBeNull();
    // A decision made while the ds_daily index is unreadable is not cached.
    resetFixtures();
    _resetHolderCache();
    DAILY = null;
    expect(await resolveSymbolByTicker("CTRA")).toBeNull();
    resetFixtures();
    expect((await resolveSymbolByTicker("CTRA"))?.symbol).toBe("BW-BBG000C3GN47");
    // A failed lookup is retried, not cached.
    resetFixtures();
    _resetHolderCache();
    SM_FAIL_KEYS = new Set(["CTRA"]);
    expect(await resolveSymbolByTicker("CTRA")).toBeNull();
    SM_FAIL_KEYS = new Set();
    expect((await resolveSymbolByTicker("CTRA"))?.symbol).toBe("BW-BBG000C3GN47");
    process.env.TICKER_HOLDER_CACHE_TTL_MS = "0";
  });
});

describe("indexFromCoords (pure ds_daily index builder)", () => {
  const syms = ["BW-1", "BW-2", "BW-3", "BW-4"];

  it("indexes display / unique / listing labels and strips only .US", () => {
    const idx = indexFromCoords(
      syms,
      ["CTRA", "BYON", "NAN", "X"],
      ["COG", "BYON", "NAN#1", "X"],
      ["CTRA.US", "BBBY.US", "NAN.US", "X.LSE"],
    )!;
    expect(idx.byTicker.get("CTRA")).toEqual(["BW-1"]);
    expect(idx.byTicker.get("COG")).toEqual(["BW-1"]);
    expect(idx.byDisplayTicker.get("COG")).toBeUndefined();
    expect(idx.byListingTicker.get("BBBY")).toEqual(["BW-2"]);
    // A real ticker spelled NAN is kept.
    expect(idx.byDisplayTicker.get("NAN")).toEqual(["BW-3"]);
    // Non-US listing codes pass through unchanged.
    expect(idx.byListingTicker.get("X.LSE")).toEqual(["BW-4"]);
    expect(idx.byListingTicker.get("X")).toBeUndefined();
    expect(idx.symbols.size).toBe(4);
  });

  it("stringifies non-string cells like readSymbolIndexMap", () => {
    const idx = indexFromCoords(["BW-1", "BW-2"], [7, "B"], ["X", "Y"], ["", ""])!;
    expect(idx.byDisplayTicker.get("7")).toEqual(["BW-1"]);
  });

  it("drops NaN / null fills at the raw value", () => {
    const idx = indexFromCoords(syms, ["A", Number.NaN, null, undefined], ["A", null, "C", "D"], ["", "", "", ""])!;
    expect(idx.byDisplayTicker.get("A")).toEqual(["BW-1"]);
    expect([...idx.byDisplayTicker.keys()]).toEqual(["A"]);
    expect(idx.byTicker.get("C")).toEqual(["BW-3"]);
  });

  it("fails closed on a duplicate symbol or a missing / misaligned coord; skips a blank symbol", () => {
    const ok = ["A", "B", "C", "D"];
    expect(indexFromCoords(["BW-1", "BW-1", "BW-3", "BW-4"], ok, ok, ok)).toBeNull();
    // A blank id drops only its own position.
    const partial = indexFromCoords(["BW-1", "", "BW-3", "BW-4"], ok, ok, ok)!;
    expect(partial.byDisplayTicker.get("B")).toBeUndefined();
    expect(partial.byDisplayTicker.get("C")).toEqual(["BW-3"]);
    expect(indexFromCoords(syms, ok, null, ok)).toBeNull();
    expect(indexFromCoords(syms, ok, ok, ["A", "B"])).toBeNull();
    expect(indexFromCoords(null, ok, ok, ok)).toBeNull();
  });
});
