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
const META = "BW-BBG000MM2P62";
const SQ = "BW-SQ";
const AAPL = "BW-BBG000B9XRY4";
const symbolRows = [
  { symbol: ETF, ticker: "SPCK", name: "The SPAC and New Issue ETF" },
  { symbol: SPACEX, ticker: "SPCX", name: "Space Exploration Technologies Corp" },
  { symbol: META, ticker: "META", name: "Meta Platforms, Inc." },
  { symbol: SQ, ticker: "XYZ", name: "Block, Inc." },
  { symbol: AAPL, ticker: "AAPL", name: "Apple Inc" },
  { symbol: "BW-BBG00GCTC8Y9", ticker: "SOS", name: "SOS Ltd" },
  { symbol: "BW-BBG0125CL1D2", ticker: "IXHL", name: "Incannex Healthcare Inc." },
  { symbol: "BW-BBG0116Y22N3", ticker: "NEXN", name: "Nexxen International Ltd." },
];

const aliasRows = [
  { bw_sym_id: META, alias_value: "FB", alias_type: "TICKER", valid_from: "2012-05-18", valid_to: "2022-06-09" },
  { bw_sym_id: META, alias_value: "META", alias_type: "TICKER", valid_from: "2022-06-09", valid_to: null },
  { bw_sym_id: SQ, alias_value: "SQ", alias_type: "TICKER", valid_from: "2015-11-19", valid_to: "2025-01-21" },
  { bw_sym_id: SQ, alias_value: "XYZ", alias_type: "TICKER", valid_from: "2025-01-21", valid_to: null },
  { bw_sym_id: SPACEX, alias_value: "SPCX", alias_type: "TICKER", valid_from: "2026-06-12", valid_to: null },
  { bw_sym_id: AAPL, alias_value: "AAPL", alias_type: "TICKER", valid_from: "2000-01-01", valid_to: null },
];

const masterRows = [
  { bw_sym_id: META, ticker: "META", company_name: "Meta Platforms, Inc.", cik: "0001326801", valid_from: "2012-05-18", valid_to: null, merged_into: null },
  { bw_sym_id: SQ, ticker: "XYZ", company_name: "Block, Inc.", cik: "0001512673", valid_from: "2015-11-19", valid_to: null, merged_into: null },
  { bw_sym_id: SPACEX, ticker: "SPCX", company_name: "Space Exploration Technologies Corp", cik: "0001879026", valid_from: "2026-06-12", valid_to: null, merged_into: null },
  { bw_sym_id: AAPL, ticker: "AAPL", company_name: "Apple Inc", cik: "0000320193", valid_from: "2000-01-01", valid_to: null, merged_into: null },
];

function query(rows: unknown[]) {
  let filtered = rows as Array<Record<string, unknown>>;
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (col: string, value: unknown) => {
      filtered = filtered.filter((r) => r[col] === value);
      return q;
    },
    in: (col: string, vals: unknown[]) => {
      filtered = filtered.filter((r) => vals.includes(r[col]));
      return q;
    },
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: filtered, error: null }).then(res),
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
              : table === "security_aliases" ? aliasRows
                : table === "security_master" ? masterRows
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

  it("maps a current ticker to the security and ticker that existed on the held date", async () => {
    const r = await transitionPositions([{ ticker: "META", value: 5 }], { heldOn: "2020-06-30", asOf: "2026-10-22" });
    expect(r.positions).toEqual([{ ticker: "META", value: 5 }]);
    expect(r.transitions[0]).toMatchObject({
      submitted_ticker: "META", status: "rewritten", outcome: "current_ticker_mapped_to_held_date",
      source_bw_sym_id: META, bw_sym_id: META, ticker: "META",
    });
    expect(r.transitions[0].detail).toContain(`${META}, traded as FB on that date`);
  });

  it("carries a ticker rename without a reviewed event through the current registry", async () => {
    const r = await transitionPositions([{ ticker: "SQ", value: 5 }], { heldOn: "2024-06-30", asOf: "2026-10-22" });
    expect(r.positions).toEqual([{ ticker: "XYZ", value: 5 }]);
    expect(r.transitions[0]).toMatchObject({ submitted_ticker: "SQ", status: "rewritten", bw_sym_id: SQ, ticker: "XYZ" });
  });

  it("drops a current ticker when its security did not yet exist on the held date", async () => {
    const r = await transitionPositions([{ ticker: "SPCX", value: 5 }], { heldOn: "2026-05-01", asOf: "2026-10-22" });
    expect(r.positions).toEqual([]);
    expect(r.transitions[0]).toMatchObject({
      submitted_ticker: "SPCX", status: "dropped", source_bw_sym_id: SPACEX,
      outcome: "current_security_not_valid_on_held_date", bw_sym_id: null, ticker: null,
    });
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

  it("positions_as_of maps META to the security that traded as FB on the held date", async () => {
    const { status, body } = await post({
      positions: [{ ticker: "META", value: 10 }], positions_as_of: "2020-06-30", as_of: "2026-10-22",
    });
    expect(status).toBe(200);
    expect(seen.at(-1)).toEqual([{ ticker: "META", value: 10 }]);
    expect(body.transitions[0]).toMatchObject({
      status: "rewritten", outcome: "current_ticker_mapped_to_held_date", bw_sym_id: META, ticker: "META",
    });
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

  it("a ticker whose current security was not listed on positions_as_of is a 422 with an explicit transition reason", async () => {
    const { status, body } = await post({
      positions: [{ ticker: "SPCX", value: 1 }], positions_as_of: "2026-05-01", as_of: "2026-10-22",
    });
    expect(status).toBe(422);
    expect(body.dropped).toEqual([]);
    expect(body.transitions[0]).toMatchObject({ status: "dropped", outcome: "current_security_not_valid_on_held_date" });
  });
});
