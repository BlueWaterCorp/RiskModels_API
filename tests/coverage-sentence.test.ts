import { describe, expect, it } from "vitest";
import { coverageSentence } from "@/lib/llms-txt";

describe("coverageSentence", () => {
  it("quotes the live figures", () => {
    const s = coverageSentence({
      history_starts: { returns: "2006-01-04", hedge_ratio: "2010-12-08", explained_risk: "2011-12-07", residual_share: "2011-12-07", lstar: "2013-01-01" },
      universe: { label: "uni_mc_3000", as_of: "2026-11-25", member_count: 2786 },
      stock_records: 3292,
    });
    expect(s).toContain("2,786 members on 2026-11-25");
    expect(s).toContain("3,292 US stocks");
    expect(s).toContain("2010-12-08 for hedge ratios");
  });
  it("names the endpoint when facts are unavailable", () => {
    expect(coverageSentence(null)).toContain("/api/health");
  });
});
