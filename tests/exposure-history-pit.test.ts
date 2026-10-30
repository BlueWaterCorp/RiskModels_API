/**
 * ERM3-73: point-in-time ticker windows on the tickers-only history feed
 * (POST /portfolio/exposure/history and /daily).
 *
 * The reviewed event rows are the ERM3 parity fixture (tests/fixtures/identity/security-events-parity.json);
 * Supabase is mocked with them, and the registry rows say which ticker today's registry holds each
 * security under (SPCX is SpaceX today; the ETF that used SPCX until 2026-04-07 is SPCK).
 */
import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXPOSURE_PANEL_VARS } from "@/lib/dal/zarr-reader";

const fx = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/identity/security-events-parity.json"), "utf-8"));
const currentRows = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/identity/current-ticker-production-rows.json"), "utf-8"));

const ETF = "BW-BBG00YJ8L8T5";
const SPACEX = "BW-BBG000NQF3Z5";
const META = "BW-BBG000MM2P62";
const symbolRows = [
  ...currentRows.symbols,
  { symbol: "BW-BBG00GCTC8Y9", ticker: "SOS", name: "SOS Ltd" },
  { symbol: "BW-BBG0125CL1D2", ticker: "IXHL", name: "Incannex Healthcare Inc." },
  { symbol: "BW-BBG0116Y22N3", ticker: "NEXN", name: "Nexxen International Ltd." },
];
const aliasRows: unknown[] = currentRows.security_aliases;
const masterRows: unknown[] = currentRows.security_master;

// Set to make the reviewed-events read fail (the only failure injected; every other table is the fixture).
const eventsDown = { on: false };

function query(rows: unknown[], fail = false) {
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
    then: (res: (v: unknown) => unknown) =>
      Promise.resolve(fail ? { data: null, error: { message: "connection refused" } } : { data: filtered, error: null }).then(res),
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
        table === "security_events" && eventsDown.on,
      ),
  }),
}));
vi.mock("@/lib/dal/risk-engine-v3", () => ({ resolveSymbolByTicker: vi.fn(async () => null) }));

const billed: { count: number | null } = { count: null };
vi.mock("@/lib/agent/billing-middleware", () => ({
  withBilling:
    (handler: (req: unknown, ctx: unknown) => Promise<Response>) =>
    async (req: Request) =>
      handler(req, {
        requestId: "req-1", userId: "u1", costUsd: 1.25,
        setBillableItemCount: (n: number) => { billed.count = n; },
      }),
}));
vi.mock("@/lib/dal/risk-metadata", () => ({ getRiskMetadata: async () => ({}) }));
vi.mock("@/lib/dal/response-headers", () => ({ addMetadataHeaders: () => undefined, buildMetadataBody: () => ({}) }));

// Today's pricing registry has SPCX, SPCK and META; FB has no priced row here.
const registry: Record<string, Record<string, unknown>> = {
  SPCX: { symbol: SPACEX, ticker: "SPCX", asset_type: "stock", sector_etf: null, subsector_etf: null },
  SPCK: { symbol: ETF, ticker: "SPCK", asset_type: "etf", sector_etf: null, subsector_etf: null },
  META: { symbol: META, ticker: "META", asset_type: "stock", sector_etf: "XLC", subsector_etf: null },
};
const resolved: string[][] = [];
vi.mock("@/lib/portfolio/signed-exposure-data", () => ({
  resolveAll: vi.fn(async (ts: string[]) => {
    resolved.push(ts);
    return new Map(ts.filter((t) => registry[t]).map((t) => [t, registry[t]]));
  }),
}));

const empty = () => Object.fromEntries(EXPOSURE_PANEL_VARS.map((v) => [v, [null, null]]));
vi.mock("@/lib/dal/zarr-reader", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    readExposureMonthEndPanel: vi.fn(async () => ({
      teos: ["2026-03-31", "2026-09-30"],
      etfs: ["SPY", "SPCK", "XLC"],
      cov: [new Float32Array(9).fill(1e-4), new Float32Array(9).fill(2e-4)],
      attrs: { built_utc: "2026-10-08T00:00:00Z", source_last_teo: "2026-10-07" },
      bySymbol: new Map<string, Record<string, Array<number | null>>>([
        [SPACEX, { ...empty(), l1_mkt_hr: [null, -1.4], stock_var: [null, 9e-4] }],
        [META, { ...empty(), l1_mkt_hr: [-1.2, -1.1], stock_var: [4e-4, 4e-4] }],
      ]),
    })),
  };
});
vi.mock("@/lib/supabase/storage", () => ({
  EXPOSURE_HISTORY_URL_TTL_SECONDS: 3600,
  serveExposureHistorySet: vi.fn(async () => null),
  writeExposureHistorySet: vi.fn(async (k: string, _b: unknown, files: Array<{ name: string }>) =>
    Object.fromEntries(files.map((f) => [f.name, `https://signed/${k}/${f.name}`]))),
}));

import { POST } from "@/app/api/portfolio/exposure/history/route";
import { _resetIdentityCache } from "@/lib/identity/resolve";
import { heldTickerWindows } from "@/lib/identity/transition-positions";

const AS_OF = "2026-10-27";

async function call(body: unknown) {
  const res = await (POST as unknown as (r: Request) => Promise<Response>)(
    new Request("http://test/api/portfolio/exposure/history", {
      method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
    }),
  );
  return { status: res.status, body: await res.json() };
}

const covering = <W extends { ticker: string; held_from: string | null; held_to: string | null }>(ws: W[], t: string, d: string) =>
  ws.filter((w) => w.ticker === t && (w.held_from === null || w.held_from <= d) && (w.held_to === null || d < w.held_to));

describe("heldTickerWindows: reviewed fixtures", () => {
  beforeEach(() => _resetIdentityCache());

  it("SPCX: the ETF before 2026-04-07, a dropped gap, then today's holder", async () => {
    const ws = await heldTickerWindows(["SPCX"], { asOf: AS_OF });
    expect(ws[0]).toMatchObject({
      ticker: "SPCX", held_from: null, held_to: "2026-04-07", status: "rewritten",
      priced_as: "SPCK", bw_sym_id: ETF, event_ids: ["SPCK-SPCX-20260407"],
    });
    expect(covering(ws, "SPCX", "2026-03-31")).toEqual([ws[0]]);
    const gap = covering(ws, "SPCX", "2026-04-07");
    expect(gap).toHaveLength(1);
    expect(gap[0]).toMatchObject({
      held_from: "2026-04-07", held_to: "2026-06-12", status: "dropped",
      priced_as: null, bw_sym_id: null, outcome: "current_security_not_valid_on_held_date",
    });
    const after = covering(ws, "SPCX", "2026-09-30");
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ priced_as: "SPCX", bw_sym_id: null });
    expect(after[0].status).not.toBe("rewritten");
  });

  it("FB maps to Meta before retirement; the history feed otherwise retains submitted tickers", async () => {
    const ws = await heldTickerWindows(["FB", "META"], { asOf: AS_OF });
    expect(covering(ws, "FB", "2021-12-31")[0]).toMatchObject({
      status: "rewritten", priced_as: "META", bw_sym_id: META, event_ids: ["META-FB-20220609"],
    });
    expect(covering(ws, "FB", "2023-01-03")[0]).toMatchObject({
      status: "dropped", priced_as: null, outcome: "submitted_ticker_retired",
    });
    expect(covering(ws, "META", "2020-06-30")[0]).toMatchObject({
      status: "carried", priced_as: "META", bw_sym_id: META, outcome: "held",
    });
    expect(covering(ws, "META", "2023-01-03")[0]).toMatchObject({ status: "unchanged", priced_as: "META" });
  });

  it.each([
    ["SOS", "2025-09-01", "SOS-ADS-ORD-20250908"],
    ["IXHL", "2023-11-01", "IXHL-ADS-COMMON-20231128"],
    ["NEXN", "2025-02-13", "NEXN-ADR-ORD-20250218-V2"],
  ])("%s held %s carries through %s under the same ticker", async (ticker, heldOn, eventId) => {
    const ws = await heldTickerWindows([ticker], { asOf: AS_OF });
    expect(covering(ws, ticker, heldOn)[0]).toMatchObject({ status: "carried", priced_as: ticker, event_ids: [eventId] });
  });

  it("tickers in no reviewed event get no windows", async () => {
    expect(await heldTickerWindows(["AAPL"], { asOf: AS_OF })).toEqual([]);
  });

  it("windows of one ticker tile the timeline without gaps", async () => {
    for (const t of ["SPCX", "FB", "SOS", "IXHL", "NEXN", "OIIM"]) {
      const ws = await heldTickerWindows([t], { asOf: AS_OF });
      expect(ws[0].held_from).toBeNull();
      expect(ws[ws.length - 1].held_to).toBeNull();
      for (let i = 1; i < ws.length; i++) expect(ws[i].held_from).toBe(ws[i - 1].held_to);
    }
  });
});

describe("POST /portfolio/exposure/history: point-in-time tickers", () => {
  beforeEach(() => {
    _resetIdentityCache();
    billed.count = null;
    resolved.length = 0;
  });

  it("delivers the ETF SPCX named before 2026-04-07 alongside today's SPCX, billed as one ticker", async () => {
    const { status, body } = await call({ tickers: ["SPCX"] });
    expect(status).toBe(200);
    expect(resolved[0]).toEqual(["SPCX", "SPCK"]);
    expect(body.window_targets).toEqual(["SPCK"]);
    expect(body.etfs_in_covariance).toContain("SPCK");
    expect(body.ticker_windows[0]).toMatchObject({ ticker: "SPCX", held_to: "2026-04-07", priced_as: "SPCK", bw_sym_id: ETF });
    expect(body.as_of.ticker_resolution).toMatch(/point in time/i);
    expect(billed.count).toBe(1);
  });

  it("delivers META for a submitted FB and reports the unresolved current FB", async () => {
    const { status, body } = await call({ tickers: ["FB"] });
    expect(status).toBe(200);
    expect(body.window_targets).toEqual(["META"]);
    expect(body.names_delivered).toBe(1);
    expect(body.dropped).toEqual([{ ticker: "FB", reason: "symbol_not_found" }]);
    expect(covering(body.ticker_windows, "FB", "2021-12-31")[0]).toMatchObject({ priced_as: "META", bw_sym_id: META });
  });

  it("fails open when the reviewed events cannot be read, and does not keep the failure", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    eventsDown.on = true;
    const down = await call({ tickers: ["SPCX"] });
    eventsDown.on = false;
    expect(down.status).toBe(200);
    expect(down.body.ticker_windows).toEqual([]);
    expect(down.body.window_targets).toEqual([]);
    expect(resolved[0]).toEqual(["SPCX"]); // today's registry only, as before ERM3-73
    expect(down.body.notes.some((n: string) => /windows were unavailable/.test(n))).toBe(true);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();

    const up = await call({ tickers: ["SPCX"] });
    expect(up.body.window_targets).toEqual(["SPCK"]);
    expect(up.body.notes.some((n: string) => /windows were unavailable/.test(n))).toBe(false);
    expect(up.body.files.names.url).not.toBe(down.body.files.names.url);
  });

  it("META (the name FB became) prices as itself in every window: nothing extra delivered", async () => {
    const { body } = await call({ tickers: ["META"] });
    expect(body.window_targets).toEqual([]);
    expect(resolved[0]).toEqual(["META"]);
  });
});

// The SDK join test (sdk/tests/test_exposure_history.py) reads these windows; regenerate with
// WRITE_TICKER_WINDOWS=1 npx vitest run tests/exposure-history-pit.test.ts
describe("SDK fixture: ticker windows for the reviewed fixtures", () => {
  beforeEach(() => _resetIdentityCache());

  it("matches sdk/tests/fixtures/ticker_windows_erm3_73.json", async () => {
    const path = join(process.cwd(), "sdk/tests/fixtures/ticker_windows_erm3_73.json");
    const windows = await heldTickerWindows(["SPCX", "FB", "META", "SOS", "IXHL", "NEXN", "OIIM"], { asOf: AS_OF });
    const doc = { generated_by: "tests/exposure-history-pit.test.ts", as_of: AS_OF, ticker_windows: windows };
    if (process.env.WRITE_TICKER_WINDOWS) (await import("fs")).writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
    expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual(doc);
  });
});
