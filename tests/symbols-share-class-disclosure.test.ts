import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { GET } from "@/app/api/data/symbols/[ticker]/route";

/**
 * G.35: `/api/data/symbols/:ticker` answers a dual-class request with the
 * sibling class's registry row. It must say so in the payload — the /stocks
 * badge is rendered from these fields, and re-deriving them in the web layer
 * from a second pair list is what let the two disagree in the first place.
 */

/** Registry rows the fake Supabase returns, keyed by the ticker looked up. */
const ROWS: Record<string, Record<string, unknown>> = {
  GOOG: {
    symbol: "BW-BBG009S3NB30",
    ticker: "GOOG",
    name: null,
    asset_type: "stock",
    sector_etf: "XLC",
    subsector_etf: "FDN",
    is_adr: null,
    metadata: {},
    latest_metrics: {},
    latest_vol: 0.43,
    latest_teo: "2026-07-31",
  },
  "BRK-B": {
    symbol: "BW-BBG000DWG505",
    ticker: "BRK-B",
    name: null,
    asset_type: "stock",
    sector_etf: "XLF",
    subsector_etf: "KIE",
    is_adr: null,
    metadata: {},
    latest_metrics: {},
    latest_vol: 0.15,
    latest_teo: "2026-07-31",
  },
  AAPL: {
    symbol: "BW-BBG000B9XRY4",
    ticker: "AAPL",
    name: null,
    asset_type: "stock",
    sector_etf: "XLK",
    subsector_etf: "IGV",
    is_adr: null,
    metadata: {},
    latest_metrics: {},
    latest_vol: 0.27,
    latest_teo: "2026-07-31",
  },
};

/** Records which ticker the route asked the database for. */
let lookedUp: string | null = null;

function stubSupabase() {
  const query: Record<string, unknown> = {};
  query.select = () => query;
  query.eq = (_col: string, value: string) => {
    lookedUp = value;
    return query;
  };
  query.maybeSingle = async () => ({
    data: lookedUp ? (ROWS[lookedUp] ?? null) : null,
    error: null,
  });
  return { from: () => query };
}

async function get(ticker: string) {
  const res = await GET(new Request("http://test") as never, {
    params: Promise.resolve({ ticker }),
  });
  return { status: res.status, body: await res.json() };
}

describe("GET /api/data/symbols/:ticker — share-class disclosure", () => {
  beforeEach(() => {
    lookedUp = null;
    vi.mocked(createAdminClient).mockReturnValue(stubSupabase() as never);
  });

  it("reports an ordinary ticker as its own modelled class", async () => {
    const { status, body } = await get("AAPL");
    expect(status).toBe(200);
    expect(body).toMatchObject({
      ticker: "AAPL",
      requested_ticker: "AAPL",
      is_modelled_class: true,
      modelled_ticker: null,
      share_class: null,
      modelled_share_class: null,
    });
  });

  it("discloses that GOOGL is answered with Class C's row", async () => {
    const { status, body } = await get("GOOGL");
    expect(status).toBe(200);
    expect(lookedUp).toBe("GOOG");
    expect(body).toMatchObject({
      symbol: "BW-BBG009S3NB30",
      ticker: "GOOG",
      requested_ticker: "GOOGL",
      is_modelled_class: false,
      modelled_ticker: "GOOG",
      share_class: "A",
      modelled_share_class: "C",
    });
  });

  /**
   * BRK-A has no registry row of its own, so before the projection was applied
   * here this request 404'd while BRK-B rendered — the same dual-class
   * situation handled two different ways.
   */
  it("resolves BRK-A through Class B instead of 404ing", async () => {
    const { status, body } = await get("BRK-A");
    expect(status).toBe(200);
    expect(lookedUp).toBe("BRK-B");
    expect(body).toMatchObject({
      ticker: "BRK-B",
      requested_ticker: "BRK-A",
      is_modelled_class: false,
      modelled_ticker: "BRK-B",
      share_class: "A",
      modelled_share_class: "B",
    });
  });

  it("normalizes BRK.B notation without claiming a projection", async () => {
    const { status, body } = await get("BRK.B");
    expect(status).toBe(200);
    expect(lookedUp).toBe("BRK-B");
    expect(body).toMatchObject({
      ticker: "BRK-B",
      requested_ticker: "BRK.B",
      is_modelled_class: true,
      modelled_ticker: null,
    });
  });

  it("still 404s a ticker that resolves to nothing", async () => {
    const { status } = await get("NOTATICKER");
    expect(status).toBe(404);
  });
});
