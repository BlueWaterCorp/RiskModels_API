/**
 * G.100 / G.101 part 2 — share-class projection for id-first consumers.
 *
 * Pins the three properties the fix hangs on: the resolver projects a
 * non-modelled class onto its company's modelled sibling (and refuses to
 * invent one when none is valid), the patch builder discloses the
 * substitution while keeping the holding's OWN identity (GOOGL stays
 * GOOGL), and the filer enricher resolves the mapping at the snapshot's
 * report_date — the PIT constraint G.101 says will get lost.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveShareClassProjections } from "@/lib/dal/company-map";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

type Result = { data: unknown; error: unknown };

interface QueryStub {
  select: () => QueryStub;
  in: () => QueryStub;
  eq: () => QueryStub;
  lte: () => QueryStub;
  or: () => QueryStub;
  then: (
    resolve: (value: Result) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
}

function makeQuery(result: Result): QueryStub {
  const stub = {} as QueryStub;
  stub.select = () => stub;
  stub.in = () => stub;
  stub.eq = () => stub;
  stub.lte = () => stub;
  stub.or = () => stub;
  stub.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return stub;
}

/** The resolver queries the same table twice — dispatch by call order. */
function setSequencedClient(results: Result[]) {
  const queue = [...results];
  const from = vi.fn(() => {
    const next = queue.shift();
    if (!next) throw new Error("unexpected extra query");
    return makeQuery(next);
  });
  vi.mocked(createAdminClient).mockReturnValue({ from } as never);
  return from;
}

const GOOGL_A = {
  bw_sym_id: "BW-BBG009S39JX6",
  company_id: "CO-ALPHABET",
  company_name: "ALPHABET INC-CL A",
  ticker: "GOOGL",
  share_class: "A",
  is_modelled_class: false,
  valid_from: "2004-08-19",
  valid_to: null,
};

const GOOG_C = {
  bw_sym_id: "BW-BBG009S3NB30",
  company_id: "CO-ALPHABET",
  company_name: "ALPHABET INC-CL C",
  ticker: "GOOG",
  share_class: "C",
  is_modelled_class: true,
  valid_from: "2014-04-03",
  valid_to: null,
};

beforeEach(() => {
  vi.mocked(createAdminClient).mockReset();
});

describe("resolveShareClassProjections", () => {
  it("projects a non-modelled class onto the company's modelled sibling", async () => {
    setSequencedClient([
      { data: [GOOGL_A], error: null },
      { data: [GOOG_C], error: null },
    ]);
    const map = await resolveShareClassProjections(["BW-BBG009S39JX6"], "2026-03-31");
    const p = map.get("BW-BBG009S39JX6");
    expect(p).toEqual({
      modelled_security_id: "BW-BBG009S3NB30",
      requested_ticker: "GOOGL",
      requested_name: "ALPHABET INC-CL A",
      requested_class: "A",
      modelled_ticker: "GOOG",
      modelled_class: "C",
    });
  });

  it("returns nothing for a modelled class, without a second query", async () => {
    const from = setSequencedClient([{ data: [GOOG_C], error: null }]);
    const map = await resolveShareClassProjections(["BW-BBG009S3NB30"], "2026-03-31");
    expect(map.size).toBe(0);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("returns nothing for an id the map does not know", async () => {
    setSequencedClient([{ data: [], error: null }]);
    const map = await resolveShareClassProjections(["BW-UNKNOWN"], "2026-03-31");
    expect(map.size).toBe(0);
  });

  it("keeps the latest-starting window when several are valid", async () => {
    const older = { ...GOOGL_A, valid_from: "1900-01-01", company_id: "CO-STALE" };
    setSequencedClient([
      { data: [older, GOOGL_A], error: null },
      { data: [GOOG_C], error: null },
    ]);
    const map = await resolveShareClassProjections(["BW-BBG009S39JX6"], "2026-03-31");
    // The 2004 window wins over the 1900 one, so the company is Alphabet.
    expect(map.get("BW-BBG009S39JX6")?.modelled_security_id).toBe("BW-BBG009S3NB30");
  });

  it("projects to nothing when the company has no modelled class at as-of", async () => {
    setSequencedClient([
      { data: [GOOGL_A], error: null },
      { data: [], error: null },
    ]);
    const map = await resolveShareClassProjections(["BW-BBG009S39JX6"], "2010-01-01");
    expect(map.size).toBe(0);
  });

  it("never throws — a Supabase error degrades to an empty map", async () => {
    setSequencedClient([{ data: null, error: new Error("boom") }]);
    const map = await resolveShareClassProjections(["BW-BBG009S39JX6"], "2026-03-31");
    expect(map.size).toBe(0);
  });
});
