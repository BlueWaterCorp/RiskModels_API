/**
 * ERM3-73 review: POST /api/portfolio/risk-snapshot with a dated book.
 * (1) positions_as_of, not as_of_date, triggers the transition step; as_of_date stays a label.
 * (2) Dates are validated: an impossible or future positions_as_of is a 400, a future as_of_date is only a label.
 * (3) Two positions that become one ticker are netted (FB and META recorded on 2021-12-31 both price as META).
 * Supabase and the DAL are mocked; the real portfolio core and transition step run.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fx = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/identity/security-events-parity.json"), "utf-8"));
const currentRows = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/identity/current-ticker-production-rows.json"), "utf-8"));

const META = "BW-BBG000MM2P62";
const AAPL = "BW-BBG000B9XRY4";
const symbolRows = [
  ...currentRows.symbols,
  { symbol: AAPL, ticker: "AAPL", name: "Apple Inc" },
];
const aliasRows = [
  ...currentRows.security_aliases,
  { bw_sym_id: AAPL, alias_value: "AAPL", alias_type: "TICKER", valid_from: "2000-01-01", valid_to: null },
];
const masterRows = [
  ...currentRows.security_master,
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
    or: () => q,
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

const resolved: string[][] = [];
vi.mock("@/lib/dal/risk-engine-v3", () => ({
  resolveSymbolByTicker: vi.fn(async () => null),
  fetchBatchHistory: vi.fn(async () => new Map()),
  resolveSymbolsByTickers: vi.fn(async (tickers: string[]) => {
    resolved.push(tickers);
    return new Map(tickers.map((t) => [t, { symbol: `BW-${t}`, sector_etf: "XLK", subsector_etf: null }]));
  }),
  fetchLatestMetricsWithFallback: vi.fn(async () => ({
    teo: "2026-10-22",
    metrics: { l3_mkt_er: 0.4, l3_sec_er: 0.1, l3_sub_er: 0.1, l3_res_er: 0.4, vol_23d: 0.3, price_close: 100 },
  })),
}));
vi.mock("@/lib/risk/hedge-recommendation-service", () => ({ computeHedgeRecommendationSnapshot: vi.fn(async () => null) }));
vi.mock("@/lib/agent/billing-user", () => ({ getBillingUserId: async () => ({ userId: "u1" }) }));
vi.mock("@/lib/agent/billing-middleware", () => ({
  withBilling:
    (handler: (req: unknown, ctx: unknown) => Promise<Response>) =>
    async (req: Request) =>
      handler(req, { requestId: "test-req", userId: "u1", costUsd: 0, setBillableItemCount: () => {} }),
}));
vi.mock("@/lib/cache/redis", () => ({
  getCache: async () => null,
  setCache: async () => {},
  generateCacheKey: (ns: string, h: string) => `${ns}:${h}`,
  CACHE_TTL: { HISTORICAL: 1 },
}));
vi.mock("@/lib/dal/risk-metadata", () => ({ getRiskMetadata: async () => ({}) }));
vi.mock("@/lib/dal/response-headers", () => ({ addMetadataHeaders: () => {}, buildMetadataBody: () => ({}) }));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/portfolio/risk-snapshot/route";
import { _resetIdentityCache } from "@/lib/identity/resolve";
import { transitionFootnotes } from "@/lib/identity/transition-positions";

async function post(body: Record<string, unknown>) {
  const res = await POST(
    new NextRequest("http://x/api/portfolio/risk-snapshot", { method: "POST", body: JSON.stringify({ no_cache: true, ...body }) }),
  );
  const ct = res.headers.get("content-type") ?? "";
  return { status: res.status, body: ct.includes("json") ? await res.json() : null, ct };
}

const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);

describe("POST /api/portfolio/risk-snapshot: dated book", () => {
  beforeEach(() => {
    _resetIdentityCache();
    resolved.length = 0;
  });

  it("as_of_date is only a label: SPCX is priced as submitted and no transition runs", async () => {
    const { status, body } = await post({ positions: [{ ticker: "SPCX", weight: 1 }], as_of_date: "2026-03-31" });
    expect(status).toBe(200);
    expect(resolved.at(-1)).toEqual(["SPCX"]);
    expect(body.as_of).toBe("2026-03-31");
    expect(body.transitions).toBeUndefined();
  });

  it("positions_as_of reads the book on that date: SPCX in March is the ETF, priced as SPCK", async () => {
    const { status, body } = await post({ positions: [{ ticker: "SPCX", weight: 1 }], positions_as_of: "2026-03-31" });
    expect(status).toBe(200);
    expect(resolved.at(-1)).toEqual(["SPCK"]);
    expect(body.transitions[0]).toMatchObject({ submitted_ticker: "SPCX", status: "rewritten", ticker: "SPCK" });
  });

  it("FB and META recorded on 2021-12-31 net into one META weight", async () => {
    const { status, body } = await post({
      positions: [{ ticker: "FB", weight: 0.3 }, { ticker: "META", weight: 0.2 }, { ticker: "AAPL", weight: 0.5 }],
      positions_as_of: "2021-12-31",
    });
    expect(status).toBe(200);
    expect(resolved.at(-1)).toEqual(["META", "AAPL"]);
    expect(body.per_ticker.META.weight).toBeCloseTo(0.5, 12);
    expect(body.per_ticker.AAPL.weight).toBeCloseTo(0.5, 12);
    expect(body.transitions.map((t: { submitted_ticker: string }) => t.submitted_ticker)).toContain("FB");
  });

  it.each([
    [{ positions_as_of: tomorrow }, "positions_as_of cannot be in the future"],
    [{ positions_as_of: "2026-02-30" }, "positions_as_of must be a real calendar date"],
    [{ as_of_date: "2026-02-30" }, "as_of_date must be a real calendar date"],
  ])("%o is a 400, not a 500", async (dates, message) => {
    const { status, body } = await post({ positions: [{ ticker: "SPCX", weight: 1 }], ...dates });
    expect(status).toBe(400);
    expect(body.message).toBe(message);
  });

  it("a future as_of_date is a label and does not run the transition step", async () => {
    const { status, body } = await post({ positions: [{ ticker: "AAPL", weight: 1 }], as_of_date: tomorrow });
    expect(status).toBe(200);
    expect(body.as_of).toBe(tomorrow);
  });

  it("the PDF renders with the transition footnote", async () => {
    const { status, ct } = await post({ positions: [{ ticker: "SPCX", weight: 1 }], positions_as_of: "2026-03-31", format: "pdf" });
    expect(status).toBe(200);
    expect(ct).toBe("application/pdf");
  });
});

describe("transitionFootnotes", () => {
  it("prints one line per transition under a heading", async () => {
    _resetIdentityCache();
    const { transitionPositions } = await import("@/lib/identity/transition-positions");
    const { transitions } = await transitionPositions([{ ticker: "SPCX", weight: 1 }], { heldOn: "2026-03-31", asOf: "2026-10-22" });
    expect(transitionFootnotes(transitions)).toEqual([
      "Positions recorded on 2026-03-31, carried to today's data through reviewed corporate-action events:",
      "SPCX held on 2026-03-31 is priced as SPCK (SPCK-SPCX-20260407).",
    ]);
    expect(transitionFootnotes([])).toEqual([]);
  });

  it("prints the explicit reason for a held-date identity drop", () => {
    expect(transitionFootnotes([{
      submitted_ticker: "SPCX", held_on: "2026-05-01", as_of: "2026-10-22", status: "dropped",
      identity_source: "ticker_alias_window", source_bw_sym_id: "BW-BBG000NQF3Z5", bw_sym_id: null, ticker: null,
      held_date_tickers: [],
      outcome: "current_security_not_valid_on_held_date", event_ids: [], steps: [],
      detail: "SPCX on 2026-10-22 resolves to BW-BBG000NQF3Z5, which was not valid on 2026-05-01. Position dropped.",
    }])[1]).toContain("which was not valid on 2026-05-01");
  });
});
