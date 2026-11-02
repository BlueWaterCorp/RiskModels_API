import { describe, expect, it } from "vitest";
import { buildFeedDescriptor, feedDescriptorJson } from "@/lib/feed-descriptor";
import { GET } from "@/app/security-master-feed/descriptor.json/route";

// Stored reversed so the words themselves never appear in the repo.
const FORBIDDEN = ["pisuc", "nisi", "tesTcaf", "dhdoe", "grebmoolb", "vitinifer", "arrab", "amoixa", "icsm"].map(
  (w) => new RegExp(`\\b${w.split("").reverse().join("")}\\b`, "i"),
);

describe("feed descriptor", () => {
  it("describes the feed as early access with no first edition", () => {
    const d = buildFeedDescriptor();
    expect(d.schema).toBe("riskmodels.feed-descriptor/1");
    expect(d.status).toBe("early_access");
    expect(d.first_edition).toBeNull();
    expect(d.caveats.join(" ")).toMatch(/no edition has been published yet/i);
    expect(d.caveats.join(" ")).toMatch(/No coverage, latency or quality figures/);
  });

  it("promises only what the page and the scope document say", () => {
    // Per-edition status of contained open issues comes from a plan that has not merged; it stays out
    // of the descriptor until the page says it too.
    expect(feedDescriptorJson()).not.toMatch(/contained open issue/i);
    expect(buildFeedDescriptor().edition_contents).toEqual([
      "events learned that day",
      "corrections to earlier editions: old value, new value, first edition, reason",
    ]);
  });

  it("describes the two-address pattern: a contact and an optional delivery address that confirm separately", () => {
    const d = buildFeedDescriptor();
    expect(d.addresses.contact).toMatch(/notices/);
    expect(d.addresses.delivery).toMatch(/team mailbox or an agent inbox/);
    expect(d.addresses.delivery).toMatch(/confirms for itself/);
  });

  it("limits keys to FIGI, CIK, the RiskModels id and ticker", () => {
    expect(buildFeedDescriptor().scope.keys).toEqual(["figi", "cik", "riskmodels_id", "ticker"]);
  });

  it("gives an agent relevance rules and an evaluation recipe", () => {
    const d = buildFeedDescriptor();
    expect(d.relevant_if.length).toBeGreaterThan(2);
    expect(d.not_relevant_if.length).toBeGreaterThan(1);
    expect(d.how_to_evaluate.length).toBeGreaterThan(2);
    expect(d.complements).toMatch(/not a replacement/);
  });

  it("switches to published with a first-edition date", () => {
    const d = buildFeedDescriptor({ status: "published", firstEdition: "2026-11-16" });
    expect(d.status).toBe("published");
    expect(d.first_edition).toBe("2026-11-16");
    expect(d.caveats.join(" ")).not.toMatch(/no edition has been published/i);
  });

  it("contains no forbidden identifier scheme or vendor name", () => {
    for (const re of FORBIDDEN) expect(feedDescriptorJson()).not.toMatch(re);
  });

  it("is served as JSON at the descriptor route", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(res.headers.get("cache-control")).toMatch(/s-maxage/);
    const body = await res.json();
    expect(body.links.descriptor).toBe("https://riskmodels.app/security-master-feed/descriptor.json");
  });
});
