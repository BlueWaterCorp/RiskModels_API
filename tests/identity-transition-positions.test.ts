/**
 * ERM3-73 acceptance: dated books in POST /api/portfolio/exposure and the shared transition step.
 * The five reviewed fixtures (SPCX/SPCK, SOS, IXHL, NEXN, OIIM) run over the parity fixture's event rows,
 * with Supabase mocked; the registry rows say which ticker today's registry prices each security under.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fx = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/identity/security-events-parity.json"), "utf-8"));

const ETF = "BW-BBG00YJ8L8T5";
const SPACEX = "BW-BBG000NQF3Z5";
const symbolRows = [
  { symbol: ETF, ticker: "SPCK", name: "The SPAC and New Issue ETF" },
  { symbol: SPACEX, ticker: "SPCX", name: "Space Exploration Technologies Corp" },
  { symbol: "BW-BBG00GCTC8Y9", ticker: "SOS", name: "SOS Ltd" },
  { symbol: "BW-BBG0125CL1D2", ticker: "IXHL", name: "Incannex Healthcare Inc." },
  { symbol: "BW-BBG0116Y22N3", ticker: "NEXN", name: "Nexxen International Ltd." },
];

function query(rows: unknown[]) {
  const q: Record<string, unknown> = {
    select: () => q,
    eq: () => q,
    in: (_col: string, vals: string[]) =>
      query((rows as Array<Record<string, unknown>>).filter((r) => !("symbol" in r) || vals.includes(r.symbol as string))),
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res),
  };
  return q;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) =>
      query(
        table === "security_events" ? fx.events
          : table === "security_event_legs" ? fx.legs
            : table === "symbols" ? symbolRows
              : [],
      ),
  }),
}));
vi.mock("@/lib/dal/risk-engine-v3", () => ({ resolveSymbolByTicker: vi.fn(async () => null) }));

const seen: Array<Array<{ ticker: string; value: number }>> = [];
vi.mock("@/lib/portfolio/signed-exposure-data", () => ({
  asOfBeforeEarliest: () => null,
  computePortfolioExposure: vi.fn(async (positions: Array<{ ticker: string; value: number }>) => {
    seen.push(positions);
    return { book: { modelled_stocks: positions.length, direct_etfs: 0 }, dropped: [] };
  }),
}));
vi.mock("@/lib/agent/billing-middleware", () => ({
  withBilling:
    (handler: (req: unknown, ctx: unknown) => Promise<Response>) =>
    async (req: Request) =>
      handler(req, { requestId: "test-req", userId: "u1", costUsd: 0, setBillableItemCount: () => {} }),
}));
vi.mock("@/lib/dal/risk-metadata", () => ({ getRiskMetadata: async () => ({}) }));
vi.mock("@/lib/dal/response-headers", () => ({ addMetadataHeaders: () => {}, buildMetadataBody: () => ({}) }));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/portfolio/exposure/route";
import { _resetIdentityCache } from "@/lib/identity/resolve";
import { transitionPositions } from "@/lib/identity/transition-positions";

// ticker, held_on, as_of, ticker priced, event id, exact ratio, instrument after
const FIXTURES: Array<[string, string, string, string, string, string, string]> = [
  ["SPCX", "2026-03-31", "2026-06-12", "SPCK", "SPCK-SPCX-20260407", "1/1", "The SPAC and New Issue ETF"],
  ["SOS", "2025-09-01", "2025-09-08", "SOS", "SOS-ADS-ORD-20250908", "1/1", "SOS Limited Class A ordinary share"],
  ["IXHL", "2023-11-01", "2023-11-30", "IXHL", "IXHL-ADS-COMMON-20231128", "1/4", "Incannex Healthcare Inc. Delaware common stock"],
  ["NEXN", "2025-02-13", "2025-02-18", "NEXN", "NEXN-ADR-ORD-20250218-V2", "1/1", "Nexxen International Ltd. ordinary share"],
  ["OIIM", "2005-11-24", "2005-11-28", "OIIM", "OIIM-ORD-ADS-20051128-V2", "1/1", "O2Micro International Limited ADS"],
];

async function post(body: unknown) {
  const res = await POST(new NextRequest("http://x/api/portfolio/exposure", { method: "POST", body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}

describe("transitionPositions: the five reviewed fixtures", () => {
  beforeEach(() => _resetIdentityCache());

  it.each(FIXTURES)("%s held %s, priced %s", async (ticker, heldOn, asOf, priced, eventId, ratio, instrument) => {
    const { positions, transitions } = await transitionPositions([{ ticker, value: 1000 }], { heldOn, asOf });
    expect(positions).toEqual([{ ticker: priced, value: 1000 }]);
    expect(transitions).toHaveLength(1);
    const t = transitions[0];
    expect(t.status).toBe(priced === ticker ? "carried" : "rewritten");
    expect(t.event_ids).toEqual([eventId]);
    expect(t.steps.map((s) => [s.event_id, s.ratio, s.to_instrument])).toEqual([[eventId, ratio, instrument]]);
    expect(t.steps[0].source.url).toMatch(/^https:\/\/www\.sec\.gov\//);
  });

  it("a book recorded after the event is left alone", async () => {
    const r = await transitionPositions([{ ticker: "SOS", value: 5 }], { heldOn: "2025-10-01", asOf: "2026-10-01" });
    expect(r).toEqual({ positions: [{ ticker: "SOS", value: 5 }], transitions: [] });
  });

  it("tickers outside reviewed events pass through untouched", async () => {
    const r = await transitionPositions([{ ticker: "AAPL", value: 5 }], { heldOn: "2020-01-02", asOf: "2026-10-01" });
    expect(r).toEqual({ positions: [{ ticker: "AAPL", value: 5 }], transitions: [] });
  });

  it("a cash merger drops the position and says so", async () => {
    const r = await transitionPositions([{ ticker: "TWTR", value: 5 }, { ticker: "AAPL", value: 7 }], { heldOn: "2020-01-02", asOf: "2026-10-01" });
    expect(r.positions).toEqual([{ ticker: "AAPL", value: 7 }]);
    expect(r.transitions[0]).toMatchObject({ status: "dropped", outcome: "cashed_out", event_ids: ["TWTR-CASH-20221027"] });
  });

  it("a spin-off is not split without prices", async () => {
    const r = await transitionPositions([{ ticker: "GE", value: 9 }], { heldOn: "2022-06-01", asOf: "2023-06-01" });
    expect(r.positions).toEqual([{ ticker: "GE", value: 9 }]);
    expect(r.transitions[0].status).toBe("unsupported");
    expect(r.transitions[0].event_ids).toContain("GE-GEHC-20230103");
  });
});

describe("POST /api/portfolio/exposure with a dated book", () => {
  beforeEach(() => {
    _resetIdentityCache();
    seen.length = 0;
  });

  it.each(FIXTURES)("%s held %s is priced as %s at as_of", async (ticker, heldOn, asOf, priced, eventId) => {
    const { status, body } = await post({ positions: [{ ticker, value: 1000 }], positions_as_of: heldOn, as_of: asOf });
    expect(status).toBe(200);
    expect(seen.at(-1)).toEqual([{ ticker: priced, value: 1000 }]);
    expect(body.transitions[0].event_ids).toEqual([eventId]);
  });

  it("as_of alone reads the book on that date: SPCX in March is the ETF, priced as SPCK", async () => {
    const { body } = await post({ positions: [{ ticker: "SPCX", value: 10 }], as_of: "2026-03-31" });
    expect(seen.at(-1)).toEqual([{ ticker: "SPCK", value: 10 }]);
    expect(body.transitions[0]).toMatchObject({ status: "rewritten", source_bw_sym_id: ETF, event_ids: [] });
  });

  it("no dates: the book is today's and no transition runs", async () => {
    const { body } = await post({ positions: [{ ticker: "SPCX", value: 10 }] });
    expect(seen.at(-1)).toEqual([{ ticker: "SPCX", value: 10 }]);
    expect(body.transitions).toBeUndefined();
  });

  it("positions_as_of after as_of is a 400", async () => {
    const { status } = await post({ positions: [{ ticker: "SOS", value: 1 }], positions_as_of: "2025-10-01", as_of: "2025-09-01" });
    expect(status).toBe(400);
  });

  it("a book that is all cash by as_of is a 422 with the transitions", async () => {
    const { status, body } = await post({ positions: [{ ticker: "TWTR", value: 1 }], positions_as_of: "2020-01-02", as_of: "2024-01-02" });
    expect(status).toBe(422);
    expect(body.transitions[0].status).toBe("dropped");
  });
});
