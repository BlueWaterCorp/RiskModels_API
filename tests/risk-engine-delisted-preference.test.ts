import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import {
  isDeadSymbolRow,
  pickLiveRow,
  resolveSymbolByTicker,
  resolveSymbolsByTickers,
} from "@/lib/dal/risk-engine-v3";
import { _resetClassProjectionsCache } from "@/lib/ticker-aliases";

/**
 * 2026-09-08 regression: the ERM3 sync never prunes `symbols`, so a recycled
 * ticker keeps its dead holder beside the live one. The DAL picked the lowest
 * bw_sym_id, which for APC was the closed 2019 Anadarko row — a covered name
 * returned 404 while the live ARKO row had betas. The sync now flags dead
 * identities (`metadata.is_delisted`), and both resolvers must prefer a live
 * row, falling back to bw_sym_id order only among rows of the same liveness.
 */

function row(symbol: string, ticker: string, dead = false) {
  return {
    symbol,
    ticker,
    name: null,
    asset_type: "stock",
    sector_etf: "XLE",
    subsector_etf: null,
    is_adr: null,
    metadata: dead ? { is_delisted: true } : {},
  };
}

// Lowest bw_sym_id is the DEAD row on purpose.
const REGISTRY: Record<string, Record<string, unknown>[]> = {
  APC: [row("BW-US0325111070", "APC", true), row("BW-US04124A1007#1", "APC")],
  HOS: [row("BW-BBG00JNKVH42", "HOS", true), row("BW-BBG01KH777Q9", "HOS")],
  DEAD: [row("BW-DEAD-ONLY", "DEAD", true)],
  AAPL: [row("BW-BBG000B9XRY4", "AAPL")],
};

function stubSupabase() {
  return {
    from(table: string) {
      const state: { eqValue?: string; inValues?: string[] } = {};
      const query: Record<string, unknown> = {};
      const respond = () => {
        if (table === "class_projections_current") return { data: [], error: null };
        if (table === "symbols") {
          if (state.eqValue !== undefined) {
            return { data: REGISTRY[state.eqValue] ?? [], error: null };
          }
          if (state.inValues !== undefined) {
            return {
              data: state.inValues.flatMap((t) => REGISTRY[t] ?? []),
              error: null,
            };
          }
        }
        return { data: [], error: null };
      };
      query.select = () => query;
      query.eq = (_c: string, v: string) => {
        state.eqValue = v;
        return query;
      };
      query.in = (_c: string, v: string[]) => {
        state.inValues = v;
        return query;
      };
      query.order = () => query;
      query.limit = () => query;
      query.maybeSingle = async () => ({ data: null, error: null });
      (query as { then?: unknown }).then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve(respond()).then(resolve);
      return query;
    },
  };
}

describe("symbols resolution prefers the live identity on a recycled ticker", () => {
  beforeEach(() => {
    _resetClassProjectionsCache();
    vi.mocked(createAdminClient).mockReturnValue(stubSupabase() as never);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://stub.local";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-key";
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("pickLiveRow: live beats dead, then lowest bw_sym_id", () => {
    expect(pickLiveRow(REGISTRY.APC)?.symbol).toBe("BW-US04124A1007#1");
    expect(pickLiveRow([row("BW-B", "X"), row("BW-A", "X")])?.symbol).toBe("BW-A");
    expect(pickLiveRow([])).toBeNull();
    expect(isDeadSymbolRow(row("BW-1", "X", true))).toBe(true);
    expect(isDeadSymbolRow(row("BW-1", "X"))).toBe(false);
    expect(isDeadSymbolRow(null)).toBe(false);
  });

  it("single resolver returns the live ARKO row for APC, not the 2019 Anadarko row", async () => {
    const rec = await resolveSymbolByTicker("APC");
    expect(rec).toMatchObject({ symbol: "BW-US04124A1007#1", ticker: "APC" });
  });

  it("a ticker whose only row is dead still resolves (never 404 an only row)", async () => {
    const rec = await resolveSymbolByTicker("DEAD");
    expect(rec).toMatchObject({ symbol: "BW-DEAD-ONLY", ticker: "DEAD" });
  });

  it("batch resolver agrees with the single resolver", async () => {
    const map = await resolveSymbolsByTickers(["APC", "HOS", "AAPL", "DEAD"]);
    expect(map.get("APC")?.symbol).toBe("BW-US04124A1007#1");
    expect(map.get("HOS")?.symbol).toBe("BW-BBG01KH777Q9");
    expect(map.get("AAPL")?.symbol).toBe("BW-BBG000B9XRY4");
    expect(map.get("DEAD")?.symbol).toBe("BW-DEAD-ONLY");
    for (const t of ["APC", "HOS"]) {
      const single = await resolveSymbolByTicker(t);
      expect(map.get(t)?.symbol).toBe(single?.symbol);
    }
  });
});
