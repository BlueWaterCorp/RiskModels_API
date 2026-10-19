/**
 * GET /api/identity/resolve: route contract over the parity fixture's event rows (Supabase mocked).
 */
import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fx = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/identity/security-events-parity.json"), "utf-8"));
let aliasRows: Array<{ bw_sym_id: string; valid_from: string | null; valid_to: string | null }> = [];
let masterRows: Array<{ bw_sym_id: string; cik: string | null; merged_into: string | null; ticker?: string; company_name?: string }> = [];
let nameRows: Array<Record<string, unknown>> = [];

function query(rows: unknown[]) {
  const q: Record<string, unknown> = {
    select: () => q,
    eq: () => q,
    in: () => q,
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
            : table === "security_aliases" ? aliasRows
              : table === "security_master" ? masterRows
                : table === "security_name_history" ? nameRows
                : [],
      ),
  }),
}));
vi.mock("@/lib/dal/risk-engine-v3", () => ({ resolveSymbolByTicker: vi.fn(async () => null) }));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/identity/resolve/route";
import { _resetIdentityCache } from "@/lib/identity/resolve";

async function call(qs: string) {
  const res = await GET(new NextRequest(`http://x/api/identity/resolve?${qs}`));
  return { status: res.status, body: await res.json() };
}

describe("GET /api/identity/resolve", () => {
  beforeEach(() => {
    _resetIdentityCache();
    aliasRows = [];
    masterRows = [];
    nameRows = [];
  });

  it("BBBY held in 2020 is the original company, cancelled with no equity successor", async () => {
    const { status, body } = await call("identifier=BBBY&acquired_on=2020-01-02&as_of=2026-10-18");
    expect(status).toBe(200);
    expect(body.identity.bw_sym_id).toBe("BW-BBG0087LHFY9");
    expect(body.result.outcome).toBe("cancelled");
    expect(body.result.no_equity_successor).toBe(true);
    expect(body.result.holdings).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("BW-BBG000BF7BV7"); // never the later brand owner
    expect(body.coverage).toBe("reviewed");
    expect(body.events[0].source.url).toMatch(/^https:\/\/www\.sec\.gov\//);
  });

  it("TWTR becomes cash only, never X equity", async () => {
    const { body } = await call("identifier=TWTR&acquired_on=2020-01-02&as_of=2026-10-18");
    expect(body.result.outcome).toBe("cashed_out");
    expect(body.result.cash).toEqual([
      { event_id: "TWTR-CASH-20221027", currency: "USD", amount: "5420", in_lieu_of_units: null, in_lieu_of: null },
    ]);
    expect(body.result.no_equity_successor).toBe(true);
  });

  it("AT&T distribution keeps T and adds WBD with cash in lieu", async () => {
    const { body } = await call("identifier=T&acquired_on=2021-01-04&as_of=2026-10-18");
    expect(body.result.holdings.map((h: { ticker: string; quantity: string }) => [h.ticker, h.quantity])).toEqual([
      ["T", "100"],
      ["WBD", "24"],
    ]);
    expect(body.result.cash[0].in_lieu_of_units).toBe("0.1917");
    expect(body.events[0].event_type).toBe("distribution");
  });

  it("SOS ADS to ordinary: same id continues, but the instrument change is explicit", async () => {
    const { body } = await call("identifier=SOS&acquired_on=2025-01-02&as_of=2026-10-18");
    const out = body.events.find((e: { event_id: string }) => e.event_id === "SOS-ADS-ORD-20250908").outputs[0];
    expect(out).toMatchObject({ bw_sym_id: "BW-BBG00GCTC8Y9", instrument: "SOS Limited Class A ordinary share", instrument_changed: true });
    expect(body.result.holdings[0].instrument).toBe("SOS Limited Class A ordinary share");
    expect(body.explanation).toMatch(/American depositary share became SOS Limited Class A ordinary share/);
  });

  it("a plain cash-out output is not an instrument change", async () => {
    const { body } = await call("identifier=TWTR&acquired_on=2020-01-02&as_of=2026-10-18");
    expect(body.events.flatMap((e: { outputs: { instrument_changed: boolean }[] }) => e.outputs).every((o: { instrument_changed: boolean }) => !o.instrument_changed)).toBe(true);
  });

  it("2026 BBBY is the Overstock line, by reviewed window", async () => {
    const { body } = await call("identifier=BBBY&as_of=2026-01-05");
    expect(body.identity).toMatchObject({ bw_sym_id: "BW-BBG000BF7BV7", source: "reviewed_event_window" });
  });

  it("an unknown historical ticker is unavailable, not guessed", async () => {
    const { body } = await call("identifier=ZZZZ&as_of=2015-01-02");
    expect(body.status).toBe("unavailable");
    expect(body.coverage).toBe("unknown");
    expect(body.result.holdings).toEqual([]);
  });

  it("conflicting alias windows are ambiguous", async () => {
    aliasRows = [
      { bw_sym_id: "BW-A", valid_from: null, valid_to: null },
      { bw_sym_id: "BW-B", valid_from: "2010-01-01", valid_to: null },
    ];
    masterRows = [
      { bw_sym_id: "BW-A", cik: "1", merged_into: null },
      { bw_sym_id: "BW-B", cik: "2", merged_into: null },
    ];
    const { body } = await call("identifier=QQQQ&as_of=2015-01-02");
    expect(body.status).toBe("ambiguous");
    expect(body.identity.candidates.map((c: { bw_sym_id: string }) => c.bw_sym_id)).toEqual(["BW-A", "BW-B"]);
  });

  it("a buyer between record and distribution is reported unsupported", async () => {
    const { body } = await call("identifier=BW-BBG000BK6MB5&acquired_on=2022-12-20&as_of=2023-06-01");
    expect(body.status).toBe("unsupported");
    expect(body.coverage).toBe("unknown");
  });

  it("rejects bad dates and inverted windows", async () => {
    expect((await call("identifier=T&as_of=2026-13-40")).status).toBe(400);
    expect((await call("identifier=T&acquired_on=2026-10-18&as_of=2021-01-04")).status).toBe(400);
    expect((await call("as_of=2021-01-04")).status).toBe(400);
  });

  it("drops alias ids missing from the security master and reports them (live AAPL shape)", async () => {
    aliasRows = [
      { bw_sym_id: "BW-BBG000B9XRY4", valid_from: "2000-01-01", valid_to: null },
      { bw_sym_id: "BW-SY1T29J3RVQWY", valid_from: "2006-01-03", valid_to: null },
    ];
    masterRows = [{ bw_sym_id: "BW-BBG000B9XRY4", cik: "0000320193", merged_into: null }];
    const { body } = await call("identifier=AAPL&as_of=2020-01-02");
    expect(body.identity).toMatchObject({ status: "resolved", bw_sym_id: "BW-BBG000B9XRY4", source: "ticker_alias_window" });
    expect(body.identity.excluded_candidates).toEqual([{ bw_sym_id: "BW-SY1T29J3RVQWY", reason: "alias id not in the security master" }]);
    expect(body.coverage).toBe("inferred");
  });

  it("follows a merged alias id to its survivor", async () => {
    aliasRows = [{ bw_sym_id: "BW-DUP", valid_from: null, valid_to: null }];
    masterRows = [
      { bw_sym_id: "BW-DUP", cik: "9", merged_into: "BW-SURV" },
      { bw_sym_id: "BW-SURV", cik: "9", merged_into: null },
    ];
    const { body } = await call("identifier=QQQQ&as_of=2015-01-02");
    expect(body.identity.bw_sym_id).toBe("BW-SURV");
  });

  it("same-issuer duplicate records do not make a reviewed id ambiguous (live BBBY shape)", async () => {
    aliasRows = [
      { bw_sym_id: "BW-BBG0087LHFY9", valid_from: null, valid_to: "2023-07-10" },
      { bw_sym_id: "BW-C0000886158", valid_from: null, valid_to: "2023-07-10" },
    ];
    masterRows = [
      { bw_sym_id: "BW-BBG0087LHFY9", cik: "0000886158", merged_into: null },
      { bw_sym_id: "BW-C0000886158", cik: "0000886158", merged_into: null },
    ];
    const { body } = await call("identifier=BBBY&acquired_on=2020-01-02&as_of=2026-10-18");
    expect(body.identity).toMatchObject({ status: "resolved", bw_sym_id: "BW-BBG0087LHFY9", duplicate_records: ["BW-C0000886158"] });
    expect(body.result.outcome).toBe("cancelled");
    expect(body.coverage).toBe("reviewed");
  });
});

describe("GET /api/identity/resolve: reviewed events outrank aliases", () => {
  beforeEach(() => {
    _resetIdentityCache();
  });

  it("today's FB is not Meta even when an undated alias says so (live shape)", async () => {
    aliasRows = [{ bw_sym_id: "BW-BBG000MM2P62", valid_from: "2012-05-18", valid_to: null }];
    masterRows = [{ bw_sym_id: "BW-BBG000MM2P62", cik: "0001326801", merged_into: null }];
    const { body } = await call("identifier=FB&as_of=2024-06-03");
    expect(body.identity.bw_sym_id).not.toBe("BW-BBG000MM2P62");
    expect(body.identity.excluded_candidates[0].reason).toMatch(/2022-06-09/);
  });

  it("names a holding as of the date, with share class, and keeps today's name separately", async () => {
    aliasRows = [{ bw_sym_id: "BW-BBG000MM2P62", valid_from: "2012-05-18", valid_to: null }];
    masterRows = [{ bw_sym_id: "BW-BBG000MM2P62", cik: "0001326801", merged_into: null, company_name: "Meta Platforms, Inc." }];
    nameRows = [
      { bw_sym_id: "BW-BBG000MM2P62", kind: "issuer_legal", name: "Facebook Inc", valid_from: "2005-05-06", valid_to: "2021-10-28", source: "edgar" },
      { bw_sym_id: "BW-BBG000MM2P62", kind: "issuer_legal", name: "Meta Platforms, Inc.", valid_from: "2021-10-28", valid_to: null, source: "edgar" },
      { bw_sym_id: "BW-BBG000MM2P62", kind: "share_class", name: "Class A", valid_from: null, valid_to: null, source: "figi" },
    ];
    const { body } = await call("identifier=FB&as_of=2015-06-01");
    expect(body.identity).toMatchObject({ bw_sym_id: "BW-BBG000MM2P62", name: "Facebook Inc Class A", share_class: "Class A", current_name: "Meta Platforms, Inc." });
  });

  it("today's FB is the security-master row that now carries the ticker (the ETF)", async () => {
    aliasRows = [{ bw_sym_id: "BW-BBG000MM2P62", valid_from: "2012-05-18", valid_to: null }];
    masterRows = [
      { bw_sym_id: "BW-BBG000MM2P62", cik: "0001326801", merged_into: null },
      { bw_sym_id: "BW-BBG01VRMNFB1", cik: null, merged_into: null, ticker: "FB", company_name: "PROSHARES TR" },
    ];
    const { body } = await call("identifier=FB&as_of=2026-10-16");
    expect(body.identity).toMatchObject({ bw_sym_id: "BW-BBG01VRMNFB1", source: "security_master_ticker" });
    expect(body.result.holdings[0]).toMatchObject({ ticker: "FB", name: "PROSHARES TR" });
    expect(body.coverage).toBe("inferred");
  });
});
