import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetClassProjectionsCache,
  resolveTicker,
  resolveTickerAlias,
  resolveTickerAliases,
} from "@/lib/ticker-aliases";

/**
 * G.35: notation rewrites and share-class projections are different relations.
 * Reporting a notation rewrite would be noise; failing to report a projection
 * is what let `/stocks/GOOGL` render GOOG's decomposition undisclosed.
 *
 * H.144: projections now come from the `class_projections_current` mirror of
 * ERM3's `security_company_map`. The mock below stands in for the Supabase
 * admin client; `mockProjectionRows` / `mockProjectionError` control what the
 * "mirror" serves per test. With no Supabase env at all (the default in this
 * suite unless stubbed), the resolver must behave exactly as it did before
 * H.144 — the two hand-written entries.
 */

let mockProjectionRows: Array<Record<string, string | null>> | null = null;
let mockProjectionError: Error | null = null;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        limit: async () => {
          if (mockProjectionError) throw mockProjectionError;
          expect(table).toBe("class_projections_current");
          return { data: mockProjectionRows, error: null };
        },
      }),
    }),
  }),
}));

beforeEach(() => {
  _resetClassProjectionsCache();
  mockProjectionRows = null;
  mockProjectionError = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function stubSupabaseEnv() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
}

describe("resolveTicker (fallback table — no Supabase configured)", () => {
  it("passes an ordinary ticker through unchanged and unprojected", async () => {
    expect(await resolveTicker("AAPL")).toEqual({
      requested: "AAPL",
      canonical: "AAPL",
      projected: false,
      requestedClass: null,
      modelledClass: null,
    });
  });

  it("uppercases and trims before resolving", async () => {
    expect(await resolveTicker("  googl ")).toMatchObject({
      requested: "GOOGL",
      canonical: "GOOG",
      projected: true,
    });
  });

  it("returns an empty resolution for empty input rather than throwing", async () => {
    expect(await resolveTicker("")).toMatchObject({
      requested: "",
      canonical: "",
    });
  });

  describe("notation aliases — same security, no disclosure", () => {
    it.each([
      ["BRK.B", "BRK-B"],
      ["BRKB", "BRK-B"],
    ])("%s normalizes to %s without projecting", async (input, expected) => {
      const r = await resolveTicker(input);
      expect(r.canonical).toBe(expected);
      expect(r.projected).toBe(false);
      expect(r.requestedClass).toBeNull();
    });
  });

  describe("class projections — different security, must be disclosed", () => {
    it("projects Alphabet Class A onto Class C", async () => {
      expect(await resolveTicker("GOOGL")).toEqual({
        requested: "GOOGL",
        canonical: "GOOG",
        projected: true,
        requestedClass: "A",
        modelledClass: "C",
      });
    });

    it("projects Berkshire Class A onto Class B", async () => {
      expect(await resolveTicker("BRK-A")).toEqual({
        requested: "BRK-A",
        canonical: "BRK-B",
        projected: true,
        requestedClass: "A",
        modelledClass: "B",
      });
    });

    it("does not project the modelled class onto itself", async () => {
      for (const t of ["GOOG", "BRK-B"]) {
        expect(await resolveTicker(t)).toMatchObject({
          canonical: t,
          projected: false,
        });
      }
    });
  });

  /**
   * ERM3's map sent BRKA straight to BRK-B, collapsing both relations into one
   * hop. Split, BRKA is Class A notation that then projects — so the caller can
   * be told it is looking at Class B.
   */
  it("normalizes notation first, then projects, reporting only the projection", async () => {
    expect(await resolveTicker("BRKA")).toEqual({
      requested: "BRKA",
      canonical: "BRK-B",
      projected: true,
      requestedClass: "A",
      modelledClass: "B",
    });
  });
});

describe("resolveTicker (mirrored security_company_map — H.144)", () => {
  it("projects a dual-class name that is NOT in the hand-written table", async () => {
    stubSupabaseEnv();
    mockProjectionRows = [
      {
        requested_ticker: "LEN-B",
        requested_class: "B",
        modelled_ticker: "LEN",
        modelled_class: "",
      },
    ];
    expect(await resolveTicker("LEN-B")).toEqual({
      requested: "LEN-B",
      canonical: "LEN",
      projected: true,
      requestedClass: "B",
      modelledClass: null,
    });
  });

  it("keeps GOOGL's class letters when the mirror row lacks them (stem-class tickers are not parsed upstream)", async () => {
    stubSupabaseEnv();
    mockProjectionRows = [
      {
        requested_ticker: "GOOGL",
        requested_class: "",
        modelled_ticker: "GOOG",
        modelled_class: "",
      },
      {
        requested_ticker: "BRK-A",
        requested_class: "A",
        modelled_ticker: "BRK-B",
        modelled_class: "B",
      },
    ];
    // Identical to the pre-H.144 hand-written resolution — the regression
    // surface the badge reads.
    expect(await resolveTicker("GOOGL")).toEqual({
      requested: "GOOGL",
      canonical: "GOOG",
      projected: true,
      requestedClass: "A",
      modelledClass: "C",
    });
    expect(await resolveTicker("BRK-A")).toEqual({
      requested: "BRK-A",
      canonical: "BRK-B",
      projected: true,
      requestedClass: "A",
      modelledClass: "B",
    });
  });

  it("does not project tickers absent from a healthy mirror, even if they are in the fallback", async () => {
    stubSupabaseEnv();
    // The mirror is authoritative when reachable and non-empty. A pair the
    // build refused (e.g. ambiguous modelled class) must not be resurrected
    // from the hand-written floor.
    mockProjectionRows = [
      {
        requested_ticker: "LEN-B",
        requested_class: "B",
        modelled_ticker: "LEN",
        modelled_class: "",
      },
    ];
    expect(await resolveTicker("GOOGL")).toMatchObject({
      canonical: "GOOGL",
      projected: false,
    });
  });

  it("falls back to the hand-written entries when the mirror is unreachable", async () => {
    stubSupabaseEnv();
    mockProjectionError = new Error("connection refused");
    expect(await resolveTicker("GOOGL")).toEqual({
      requested: "GOOGL",
      canonical: "GOOG",
      projected: true,
      requestedClass: "A",
      modelledClass: "C",
    });
    // Names only the mirror knows degrade to unprojected — never an error.
    expect(await resolveTicker("LEN-B")).toMatchObject({
      canonical: "LEN-B",
      projected: false,
    });
  });

  it("falls back to the hand-written entries when the mirror is empty", async () => {
    stubSupabaseEnv();
    mockProjectionRows = [];
    expect(await resolveTicker("BRK-A")).toEqual({
      requested: "BRK-A",
      canonical: "BRK-B",
      projected: true,
      requestedClass: "A",
      modelledClass: "B",
    });
  });

  it("serves the cached table without re-fetching inside the TTL", async () => {
    stubSupabaseEnv();
    mockProjectionRows = [
      {
        requested_ticker: "LEN-B",
        requested_class: "B",
        modelled_ticker: "LEN",
        modelled_class: "",
      },
    ];
    expect((await resolveTicker("LEN-B")).projected).toBe(true);
    // A subsequent mirror failure must not surface while the cache is warm.
    mockProjectionError = new Error("connection refused");
    expect((await resolveTicker("LEN-B")).projected).toBe(true);
  });
});

describe("resolveTickerAlias", () => {
  it("yields the canonical ticker for callers that do not disclose", async () => {
    expect(await resolveTickerAlias("GOOGL")).toBe("GOOG");
    expect(await resolveTickerAlias("BRK.B")).toBe("BRK-B");
    expect(await resolveTickerAlias("AAPL")).toBe("AAPL");
  });

  it("maps arrays elementwise", async () => {
    expect(await resolveTickerAliases(["GOOGL", "AAPL", "BRK-A"])).toEqual([
      "GOOG",
      "AAPL",
      "BRK-B",
    ]);
  });
});
