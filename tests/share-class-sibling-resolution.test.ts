/**
 * ERM3-88: GOOGL has no `symbols` row; it is answered with GOOG's series and
 * flagged `resolved_via: share_class_sibling` so callers can tell the
 * substitution happened and price fields are withheld.
 *
 * Fixtures are production rows (read 2026-10-27): `class_projections_current`
 * as served (class letters empty for the stem-class tickers) and the `symbols`
 * rows of the modelled classes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { resolveSymbolByTicker, resolveSymbolsByTickers } from "@/lib/dal/risk-engine-v3";
import { _resetClassProjectionsCache } from "@/lib/ticker-aliases";
import {
  isShareClassSibling,
  resolutionDisclosure,
  resolutionDisclosureHeaders,
} from "@/lib/dal/resolution-disclosure";

function row(symbol: string, ticker: string, sectorEtf: string, subsectorEtf: string | null) {
  return {
    symbol,
    ticker,
    name: null,
    asset_type: "stock",
    sector_etf: sectorEtf,
    subsector_etf: subsectorEtf,
    is_adr: null,
    metadata: {},
  };
}

/** Modelled classes only, as in production `symbols`. */
const REGISTRY: Record<string, Record<string, unknown>> = {
  GOOG: row("BW-BBG009S3NB30", "GOOG", "XLC", "FDN"),
  "BRK-B": row("BW-BBG000DWG505", "BRK-B", "XLF", null),
  FOXA: row("BW-BBG00JHNJW99", "FOXA", "XLC", null),
  NWSA: row("BW-BBG0035LY913", "NWSA", "XLC", null),
};

/** `class_projections_current` rows for these companies, as served. */
const PROJECTION_ROWS = [
  { requested_ticker: "GOOGL", requested_class: "", modelled_ticker: "GOOG", modelled_class: "" },
  { requested_ticker: "FOX", requested_class: "", modelled_ticker: "FOXA", modelled_class: "" },
  { requested_ticker: "NWS", requested_class: "", modelled_ticker: "NWSA", modelled_class: "" },
  { requested_ticker: "BRK-A", requested_class: "A", modelled_ticker: "BRK-B", modelled_class: "B" },
];

function stubSupabase() {
  return {
    from(table: string) {
      const state: { eqValue?: string; inValues?: string[] } = {};
      const query: Record<string, unknown> = {};
      const respond = () => {
        if (table === "class_projections_current") return { data: PROJECTION_ROWS, error: null };
        if (table === "symbols") {
          if (state.eqValue !== undefined) {
            const hit = REGISTRY[state.eqValue];
            return { data: hit ? [hit] : [], error: null };
          }
          if (state.inValues !== undefined) {
            return {
              data: state.inValues.map((t) => REGISTRY[t]).filter((r): r is Record<string, unknown> => Boolean(r)),
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
        Promise.resolve(respond())
          .then((r) => ({ ...r, count: Array.isArray(r.data) ? r.data.length : 0 }))
          .then(resolve);
      return query;
    },
  };
}

beforeEach(() => {
  _resetClassProjectionsCache();
  vi.mocked(createAdminClient).mockReturnValue(stubSupabase() as never);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://stub.local";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-key";
});

describe("ERM3-88 share-class sibling resolution", () => {
  it("GOOGL answers with GOOG's id, flagged share_class_sibling", async () => {
    const rec = await resolveSymbolByTicker("GOOGL");
    expect(rec).toMatchObject({
      symbol: "BW-BBG009S3NB30",
      ticker: "GOOGL",
      is_modelled_class: false,
      modelled_ticker: "GOOG",
      // Empty mirror class letters are filled from the reviewed overlay.
      share_class: "A",
      modelled_share_class: "C",
      resolved_via: "share_class_sibling",
      sector_etf: "XLC",
      subsector_etf: "FDN",
    });
    expect(isShareClassSibling(rec)).toBe(true);
  });

  it("GOOG itself is not flagged", async () => {
    const rec = await resolveSymbolByTicker("GOOG");
    expect(rec?.symbol).toBe("BW-BBG009S3NB30");
    expect(rec?.resolved_via).toBeUndefined();
    expect(resolutionDisclosure(rec)).toEqual({});
  });

  it("batch resolution agrees with single for every sibling pair", async () => {
    const batch = await resolveSymbolsByTickers(["GOOGL", "GOOG", "FOX", "NWS", "BRK-A"]);
    for (const t of ["GOOGL", "FOX", "NWS", "BRK-A"]) {
      const single = await resolveSymbolByTicker(t);
      expect(batch.get(t)).toEqual(single);
      expect(batch.get(t)?.resolved_via).toBe("share_class_sibling");
    }
    expect(batch.get("GOOG")?.resolved_via).toBeUndefined();
    expect(batch.get("FOX")?.symbol).toBe("BW-BBG00JHNJW99");
    expect(batch.get("NWS")?.symbol).toBe("BW-BBG0035LY913");
    expect(batch.get("BRK-A")?.symbol).toBe("BW-BBG000DWG505");
  });

  it("disclosure body and headers name the requested and modelled tickers and withhold price", async () => {
    const rec = await resolveSymbolByTicker("GOOGL");
    expect(resolutionDisclosure(rec)).toEqual({
      resolved_via: "share_class_sibling",
      requested_ticker: "GOOGL",
      modelled_ticker: "GOOG",
      share_class: "A",
      modelled_share_class: "C",
      price_withheld: true,
    });
    expect(resolutionDisclosureHeaders(rec)).toEqual({
      "X-Ticker-Resolved-Via": "share_class_sibling",
      "X-Ticker-Holder-Ticker": "GOOG",
      "X-Ticker-Price-Withheld": "true",
    });
  });

  it("FOX (no class letters anywhere) still discloses, without class fields", async () => {
    const d = resolutionDisclosure(await resolveSymbolByTicker("FOX"));
    expect(d).toEqual({
      resolved_via: "share_class_sibling",
      requested_ticker: "FOX",
      modelled_ticker: "FOXA",
      price_withheld: true,
    });
  });

  it("most_recent_holder disclosure is unchanged (no sibling fields)", () => {
    expect(
      resolutionDisclosure({
        ticker: "CTRA",
        resolved_via: "most_recent_holder",
        modelled_ticker: "COG",
        delisted: true,
      }),
    ).toEqual({ resolved_via: "most_recent_holder", modelled_ticker: "COG", delisted: true });
  });
});
