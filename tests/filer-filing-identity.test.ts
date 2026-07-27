import { describe, expect, it } from "vitest";

/**
 * Selection rules for the 13F filing identity served on
 * GET /13f/filers/{bw_filer_id}/holdings — which accession the returned
 * panel came from, its SEC form type, and its amendment semantics.
 *
 * These cover the reader's coord-handling contract without a zarr fixture:
 * ds_ph teo-axis coords in, resolved identity out. The end-to-end read
 * against a real schema-v2 store is exercised by the opt-in local-zarr
 * integration test.
 */

import {
  mergeVintageFilingIdentity,
  needsVintageLookup,
  selectFilingIdentity,
  type FilingIdentity,
} from "@/lib/dal/funds-zarr-reader";

// Shape of a 4-quarter schema-v2 ds_ph teo axis: three originals and an
// amendment that superseded 2025-06-30.
const N_TEOS = 4;
const COORDS = {
  accession_number: [
    "0000950123-25-004411",
    "0000950123-25-009120",
    "0000950123-25-013455",
    "0000950123-26-002088",
  ],
  filing_type: ["13F-HR", "13F-HR/A", "13F-HR", "13F-HR"],
  amendment_type: ["ORIGINAL", "RESTATEMENT", "ORIGINAL", "ORIGINAL"],
};

describe("selectFilingIdentity — ds_ph teo-axis coords", () => {
  it("reports an original filing at its own teo", () => {
    expect(selectFilingIdentity(COORDS, 0, N_TEOS)).toEqual({
      accession_number: "0000950123-25-004411",
      filing_type: "13F-HR",
      amendment_type: "ORIGINAL",
    });
  });

  it("reports the amendment that superseded a quarter, not the original", () => {
    expect(selectFilingIdentity(COORDS, 1, N_TEOS)).toEqual({
      accession_number: "0000950123-25-009120",
      filing_type: "13F-HR/A",
      amendment_type: "RESTATEMENT",
    });
  });

  it("distinguishes NEW_HOLDINGS amendments from restatements", () => {
    const coords = {
      ...COORDS,
      amendment_type: ["ORIGINAL", "NEW_HOLDINGS", "ORIGINAL", "ORIGINAL"],
    };
    expect(selectFilingIdentity(coords, 1, N_TEOS).amendment_type).toBe(
      "NEW_HOLDINGS",
    );
  });

  it("yields all-null on pre-schema-v2 panels that carry no filing coords", () => {
    expect(
      selectFilingIdentity(
        { accession_number: null, filing_type: null, amendment_type: null },
        1,
        N_TEOS,
      ),
    ).toEqual({
      accession_number: null,
      filing_type: null,
      amendment_type: null,
    });
  });

  it("nulls blank cells rather than serving empty strings", () => {
    const coords = {
      accession_number: ["0000950123-25-004411", "", "  ", "x"],
      filing_type: ["13F-HR", "", "13F-HR", "13F-HR"],
      amendment_type: ["ORIGINAL", "", "", "ORIGINAL"],
    };
    expect(selectFilingIdentity(coords, 1, N_TEOS)).toEqual({
      accession_number: null,
      filing_type: null,
      amendment_type: null,
    });
    expect(selectFilingIdentity(coords, 2, N_TEOS).accession_number).toBeNull();
  });

  it("ignores a coord whose length doesn't match the teo axis", () => {
    // A same-named variable on another dim (e.g. filing_event) must never be
    // indexed as if it were teo-aligned.
    const coords = {
      ...COORDS,
      filing_type: ["13F-HR", "13F-HR/A", "13F-HR"], // 3 events vs 4 teos
    };
    const identity = selectFilingIdentity(coords, 1, N_TEOS);
    expect(identity.filing_type).toBeNull();
    expect(identity.accession_number).toBe("0000950123-25-009120");
  });

  it("serves partial identity when only accession_number is published", () => {
    // Today's compatibility view: accession on teo, form/amendment absent.
    expect(
      selectFilingIdentity(
        {
          accession_number: COORDS.accession_number,
          filing_type: null,
          amendment_type: null,
        },
        1,
        N_TEOS,
      ),
    ).toEqual({
      accession_number: "0000950123-25-009120",
      filing_type: null,
      amendment_type: null,
    });
  });
});

describe("needsVintageLookup", () => {
  it("skips the extra read when ds_ph resolved everything", () => {
    expect(needsVintageLookup(selectFilingIdentity(COORDS, 0, N_TEOS))).toBe(
      false,
    );
  });

  it("skips the extra read when there is no accession to key on", () => {
    expect(
      needsVintageLookup({
        accession_number: null,
        filing_type: null,
        amendment_type: null,
      }),
    ).toBe(false);
  });

  it("triggers when an accession is known but its form type is not", () => {
    expect(
      needsVintageLookup({
        accession_number: "0000950123-25-009120",
        filing_type: null,
        amendment_type: null,
      }),
    ).toBe(true);
  });

  it("triggers when only the amendment semantics are missing", () => {
    expect(
      needsVintageLookup({
        accession_number: "0000950123-25-009120",
        filing_type: "13F-HR/A",
        amendment_type: null,
      }),
    ).toBe(true);
  });
});

describe("mergeVintageFilingIdentity", () => {
  const partial: FilingIdentity = {
    accession_number: "0000950123-25-009120",
    filing_type: null,
    amendment_type: null,
  };

  it("completes the identity from the vintage store's per-event record", () => {
    expect(
      mergeVintageFilingIdentity(partial, {
        filing_type: "13F-HR/A",
        amendment_type: "RESTATEMENT",
      }),
    ).toEqual({
      accession_number: "0000950123-25-009120",
      filing_type: "13F-HR/A",
      amendment_type: "RESTATEMENT",
    });
  });

  it("keeps ds_ph values when both stores carry the field", () => {
    expect(
      mergeVintageFilingIdentity(
        { ...partial, filing_type: "13F-HR/A" },
        { filing_type: "13F-NT", amendment_type: "NEW_HOLDINGS" },
      ).filing_type,
    ).toBe("13F-HR/A");
  });

  it("leaves nulls in place when the vintage store is unavailable", () => {
    expect(mergeVintageFilingIdentity(partial, null)).toEqual(partial);
  });

  it("does not synthesize amendment semantics from a /A suffix", () => {
    // A form type alone never implies RESTATEMENT vs NEW_HOLDINGS — the
    // distinction is a cover-page fact, and absent means absent.
    const merged = mergeVintageFilingIdentity(partial, {
      filing_type: "13F-HR/A",
      amendment_type: null,
    });
    expect(merged.filing_type).toBe("13F-HR/A");
    expect(merged.amendment_type).toBeNull();
  });
});
