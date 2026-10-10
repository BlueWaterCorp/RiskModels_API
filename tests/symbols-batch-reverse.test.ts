import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { POST } from "@/app/api/data/symbols/batch/route";

/**
 * Reverse mode of POST /api/data/symbols/batch: the bw_sym_ids a holdings
 * endpoint returns (native, BW-TICKER-*, or the BW-{FIGI} form of a
 * scrubbed id) resolve back to tickers.
 */

const SYMBOL_ROWS = [
  { symbol: "BW-BBG000B9XRY4", ticker: "AAPL", name: "Apple Inc" },
  { symbol: "BW-BBG000DWG505", ticker: "BRK-B", name: null },
];
/** A registry row whose native id is a licensed form; the scrub emits BW-{figi}. */
const FIGI_ROWS = [{ figi: "BBG000BDTBL9", ticker: "SPY", name: "SPDR S&P 500" }];

const queried: { column: string; values: string[] }[] = [];

function fakeClient() {
  return {
    from: () => ({
      select: () => ({
        in: async (column: string, values: string[]) => {
          queried.push({ column, values });
          if (column === "symbol") {
            return { data: SYMBOL_ROWS.filter((r) => values.includes(r.symbol)), error: null };
          }
          if (column === "metadata->>figi") {
            return { data: FIGI_ROWS.filter((r) => values.includes(r.figi)), error: null };
          }
          return { data: [], error: null };
        },
      }),
    }),
  };
}

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/data/symbols/batch", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  queried.length = 0;
  vi.mocked(createAdminClient).mockReturnValue(fakeClient() as never);
});

describe("POST /api/data/symbols/batch — reverse mode", () => {
  it("resolves native, BW-TICKER and FIGI-substituted ids, keyed as sent", async () => {
    const res = await post({
      symbols: ["BW-BBG000B9XRY4", "BW-TICKER-XYZ", "BW-BBG000BDTBL9", "BW-BBG000NOPE00"],
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results).toEqual({
      "BW-BBG000B9XRY4": { ticker: "AAPL", name: "Apple Inc" },
      "BW-TICKER-XYZ": { ticker: "XYZ", name: null },
      "BW-BBG000BDTBL9": { ticker: "SPY", name: "SPDR S&P 500" },
    });
    expect(json.unresolved).toEqual(["BW-BBG000NOPE00"]);
    // BW-TICKER ids never hit the database.
    expect(queried[0]!.values).not.toContain("BW-TICKER-XYZ");
  });

  it("skips the FIGI query when every id matched natively", async () => {
    await post({ symbols: ["BW-BBG000B9XRY4", "BW-BBG000DWG505"] });
    expect(queried.map((q) => q.column)).toEqual(["symbol"]);
  });

  it("rejects an empty or non-string symbols array", async () => {
    expect((await post({ symbols: [] })).status).toBe(400);
    expect((await post({ symbols: [1, 2] })).status).toBe(400);
  });

  it("rejects more than 1000 symbols", async () => {
    const symbols = Array.from({ length: 1001 }, (_, i) => `BW-TICKER-T${i}`);
    expect((await post({ symbols })).status).toBe(400);
  });
});
