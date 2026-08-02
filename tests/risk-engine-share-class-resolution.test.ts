import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveSymbolByTicker,
  resolveSymbolsByTickers,
} from "@/lib/dal/risk-engine-v3";
import { resolveTicker, _resetClassProjectionsCache } from "@/lib/ticker-aliases";

/**
 * C.13 regression: the DAL used to carry its own hardcoded pair list
 * (`TICKER_ALIASES: GOOGL↔GOOG`, bidirectional) while `batch/analyze` carried
 * a third one pointing the OTHER way (`GOOG → GOOGL`). One Alphabet holding
 * could get Class A numbers from one endpoint and Class C numbers from
 * another. Both now route through the single `resolveTicker` seam; these
 * tests pin the agreement and the notation-vs-projection split from #294:
 *
 *   BRK.B → BRK-B is NOTATION (same security)      → silent
 *   GOOGL → GOOG  is a PROJECTION (sibling class)  → disclosed
 */

/** Registry rows keyed by ticker — modelled classes only, like production. */
const REGISTRY: Record<string, Record<string, unknown>> = {
  GOOG: row("BW-BBG009S3NB30", "GOOG", "XLC"),
  "BRK-B": row("BW-BBG000DWG505", "BRK-B", "XLF"),
  LEN: row("BW-BBG000BN5HF7", "LEN", "XLY"),
  AAPL: row("BW-BBG000B9XRY4", "AAPL", "XLK"),
};

function row(symbol: string, ticker: string, sectorEtf: string) {
  return {
    symbol,
    ticker,
    name: null,
    asset_type: "stock",
    sector_etf: sectorEtf,
    subsector_etf: null,
    is_adr: null,
    metadata: {},
  };
}

/** Mirror rows as `class_projections_current` serves them (H.144). */
const PROJECTION_ROWS = [
  {
    requested_ticker: "GOOGL",
    requested_class: "A",
    modelled_ticker: "GOOG",
    modelled_class: "C",
  },
  {
    requested_ticker: "BRK-A",
    requested_class: "A",
    modelled_ticker: "BRK-B",
    modelled_class: "B",
  },
  // A pair that is NOT in the hand-written fallback — proves the mirror is
  // being read, not the two legacy entries.
  {
    requested_ticker: "LEN-B",
    requested_class: "B",
    modelled_ticker: "LEN",
    modelled_class: null,
  },
];

/**
 * Minimal chainable Supabase stub. Dispatches on table name:
 *   class_projections_current → the mirror rows (thenable at .limit)
 *   symbols                   → REGISTRY lookups via .eq / .in on ticker
 *   security_aliases          → always empty (historical-recall path unused)
 */
function stubSupabase() {
  return {
    from(table: string) {
      const state: { eqValue?: string; inValues?: string[] } = {};
      const query: Record<string, unknown> = {};
      const respond = () => {
        if (table === "class_projections_current") {
          return { data: PROJECTION_ROWS, error: null };
        }
        if (table === "symbols") {
          if (state.eqValue !== undefined) {
            const hit = REGISTRY[state.eqValue];
            return { data: hit ? [hit] : [], error: null };
          }
          if (state.inValues !== undefined) {
            return {
              data: state.inValues
                .map((t) => REGISTRY[t])
                .filter((r): r is Record<string, unknown> => Boolean(r)),
              error: null,
            };
          }
          return { data: [], error: null };
        }
        return { data: [], error: null };
      };
      query.select = () => query;
      query.eq = (_col: string, value: string) => {
        state.eqValue = value;
        return query;
      };
      query.in = (_col: string, values: string[]) => {
        state.inValues = values;
        return query;
      };
      query.order = () => query;
      query.limit = () => query;
      query.maybeSingle = async () => ({ data: null, error: null });
      (query as { then?: unknown }).then = (
        resolve: (v: unknown) => unknown,
      ) => Promise.resolve(respond()).then(resolve);
      return query;
    },
  };
}

describe("risk-engine-v3 ticker resolution routes through the resolveTicker seam (C.13)", () => {
  beforeEach(() => {
    _resetClassProjectionsCache();
    vi.mocked(createAdminClient).mockReturnValue(stubSupabase() as never);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://stub.local";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-key";
  });

  it("GOOG resolves to its own row — never projected onto GOOGL", async () => {
    // The old batch/analyze map carried GOOG → GOOGL; the old DAL map carried
    // GOOG → ["GOOGL"] as a fallback. Neither direction may survive: GOOG is
    // the modelled class.
    const record = await resolveSymbolByTicker("GOOG");
    expect(record).not.toBeNull();
    expect(record).toMatchObject({
      symbol: "BW-BBG009S3NB30",
      ticker: "GOOG",
      is_modelled_class: true,
      modelled_ticker: null,
    });
  });

  it("GOOGL is answered with GOOG's row and DISCLOSED (projection)", async () => {
    const record = await resolveSymbolByTicker("GOOGL");
    expect(record).toMatchObject({
      symbol: "BW-BBG009S3NB30",
      ticker: "GOOGL",
      is_modelled_class: false,
      modelled_ticker: "GOOG",
      share_class: "A",
      modelled_share_class: "C",
    });
  });

  it("agrees with the symbols-endpoint seam on Alphabet — the batch/symbols contradiction is dead", async () => {
    // The symbols endpoints resolve through resolveTicker directly; the DAL
    // must land on the same canonical row for both spellings.
    const seam = await resolveTicker("GOOGL");
    const dal = await resolveSymbolByTicker("GOOGL");
    expect(seam.canonical).toBe("GOOG");
    expect(dal?.modelled_ticker).toBe(seam.canonical);

    const seamC = await resolveTicker("GOOG");
    const dalC = await resolveSymbolByTicker("GOOG");
    expect(seamC.projected).toBe(false);
    expect(seamC.canonical).toBe("GOOG");
    expect(dalC?.ticker).toBe("GOOG");
    // Same underlying security row answers both spellings.
    expect(dal?.symbol).toBe(dalC?.symbol);
  });

  it("BRK.B resolves to BRK-B SILENTLY (notation, same security)", async () => {
    const record = await resolveSymbolByTicker("BRK.B");
    expect(record).toMatchObject({
      symbol: "BW-BBG000DWG505",
      ticker: "BRK-B",
      is_modelled_class: true,
      modelled_ticker: null,
      share_class: null,
      modelled_share_class: null,
    });
  });

  it("BRK-A projects onto BRK-B with disclosure", async () => {
    const record = await resolveSymbolByTicker("BRK-A");
    expect(record).toMatchObject({
      ticker: "BRK-A",
      is_modelled_class: false,
      modelled_ticker: "BRK-B",
      share_class: "A",
      modelled_share_class: "B",
    });
  });

  it("mirror-only pairs resolve (LEN-B → LEN) — not just the two legacy entries", async () => {
    const record = await resolveSymbolByTicker("LEN-B");
    expect(record).toMatchObject({
      ticker: "LEN-B",
      is_modelled_class: false,
      modelled_ticker: "LEN",
      share_class: "B",
    });
  });

  it("batch resolution carries the same projection disclosure per requested key", async () => {
    const result = await resolveSymbolsByTickers([
      "GOOG",
      "GOOGL",
      "BRK.B",
      "BRK-A",
      "AAPL",
    ]);

    expect(result.get("GOOG")).toMatchObject({
      symbol: "BW-BBG009S3NB30",
      ticker: "GOOG",
      is_modelled_class: true,
    });
    expect(result.get("GOOGL")).toMatchObject({
      symbol: "BW-BBG009S3NB30",
      ticker: "GOOGL",
      is_modelled_class: false,
      modelled_ticker: "GOOG",
      share_class: "A",
      modelled_share_class: "C",
    });
    // Notation in batch: resolves, keyed by the requested spelling, silent.
    expect(result.get("BRK.B")).toMatchObject({
      symbol: "BW-BBG000DWG505",
      is_modelled_class: true,
      modelled_ticker: null,
    });
    expect(result.get("BRK-A")).toMatchObject({
      is_modelled_class: false,
      modelled_ticker: "BRK-B",
    });
    expect(result.get("AAPL")).toMatchObject({
      ticker: "AAPL",
      is_modelled_class: true,
    });
  });
});
