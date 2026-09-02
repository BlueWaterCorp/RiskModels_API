/**
 * Guards on the capability read surface (G.53).
 *
 * The invariant is the same one the table itself carries — the endpoint cannot
 * advertise more than was verified — restated at the boundary a client actually
 * reads, because the response is where an over-claim would do damage.
 */

import { describe, expect, it } from "vitest";

import {
  ARTIFACT_RENDER_CAPABILITY,
  ARTIFACT_SLUG_PARAMS,
  ARTIFACT_SUBJECT_KINDS,
  buildArtifactCapability,
  PRERENDERED_SUBJECT_KINDS,
  UNIMPLEMENTED_SUBJECT_KINDS,
  type ArtifactSubjectKind,
} from "@/lib/artifacts/render-client";

function verifiedPairsFromTable(): Array<{ slug: string; kind: string }> {
  const out: Array<{ slug: string; kind: string }> = [];
  for (const [slug, byKind] of Object.entries(ARTIFACT_RENDER_CAPABILITY)) {
    for (const [kind, cap] of Object.entries(byKind)) {
      if (cap?.status === "verified") out.push({ slug, kind });
    }
  }
  return out;
}

describe("buildArtifactCapability", () => {
  const doc = buildArtifactCapability();

  it("serves exactly the verified pairs from the table", () => {
    const expected = verifiedPairsFromTable()
      .map((p) => `${p.slug}/${p.kind}`)
      .sort();
    const served = doc.pairs.map((p) => `${p.slug}/${p.subject_kind}`).sort();
    expect(served).toEqual(expected);
  });

  it("omits every measured-unavailable and degraded pair from `pairs`", () => {
    for (const [slug, byKind] of Object.entries(ARTIFACT_RENDER_CAPABILITY)) {
      for (const [kind, cap] of Object.entries(byKind)) {
        if (cap && cap.status !== "verified") {
          expect(
            doc.pairs.some((p) => p.slug === slug && p.subject_kind === kind),
            `${slug}/${kind} is ${cap.status} and must not be advertised`,
          ).toBe(false);
        }
      }
    }
  });

  it("records every non-verified pair under `unavailable`, with a reason", () => {
    for (const [slug, byKind] of Object.entries(ARTIFACT_RENDER_CAPABILITY)) {
      for (const [kind, cap] of Object.entries(byKind)) {
        if (cap && cap.status !== "verified") {
          const row = doc.unavailable.find(
            (u) => u.slug === slug && u.subject_kind === kind,
          );
          expect(row, `${slug}/${kind} missing from unavailable`).toBeDefined();
          expect(row!.reason.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("holds the audited counts (21 verified / 9 unavailable)", () => {
    // A literal, not a computed echo: the point is that a silent capability
    // change trips a review, and re-deriving the number here would let one
    // through. Update deliberately, with the probe that justified it.
    expect(doc.counts.verified).toBe(21);
    expect(doc.counts.unavailable).toBe(9);
  });

  it("attaches per-slug param applicability from the render-svc mirror", () => {
    for (const pair of doc.pairs) {
      expect([...pair.params].sort()).toEqual(
        [...(ARTIFACT_SLUG_PARAMS[pair.slug] ?? [])].sort(),
      );
    }
    const strip = doc.pairs.find((p) => p.slug === "cumulative_return_strip");
    expect(strip?.params).toEqual(["window"]);
  });

  it("marks pre-rendered pairs and says what as_of=latest does for each", () => {
    for (const pair of doc.pairs) {
      expect(pair.prerendered).toBe(
        PRERENDERED_SUBJECT_KINDS.includes(pair.subject_kind),
      );
      expect(["loader", "newest_prerendered", "unsupported"]).toContain(pair.as_of_latest);
      if (!pair.prerendered) expect(pair.as_of_latest).toBe("loader");
    }
  });

  it("names the as-of listing route so a caller can find the dates", () => {
    expect(doc.discovery.as_of).toMatch(/^GET \/api\/artifacts\/as-of\?/);
  });

  it("narrows by subject_kind without hiding the unavailable list", () => {
    const funds = buildArtifactCapability({ subjectKind: "fund" });
    expect(funds.pairs.length).toBeGreaterThan(0);
    for (const p of funds.pairs) expect(p.subject_kind).toBe("fund");
    expect(funds.counts.verified).toBe(funds.pairs.length);
    expect(funds.unavailable).toEqual(doc.unavailable);
  });

  it("narrows by slug", () => {
    const one = buildArtifactCapability({ slug: "top_holdings_erm_stacked" });
    expect(one.pairs.map((p) => p.subject_kind).sort()).toEqual([
      "client_portfolio",
      "filer_13f",
      "fund",
    ]);
  });

  it("answers a kind with no capability as an empty list, not an error", () => {
    const etf = buildArtifactCapability({ subjectKind: "etf" });
    expect(etf.pairs).toEqual([]);
    expect(etf.counts.verified).toBe(0);
    // …and says why, rather than leaving the caller to guess whether the kind
    // is broken or merely unaudited.
    expect(etf.unimplemented_subject_kinds.etf).toContain("no ETF loader");
  });

  it("declares every subject kind render-svc resolves", () => {
    expect(doc.subject_kinds).toEqual(ARTIFACT_SUBJECT_KINDS);
    // `fund_cohort` was retired 2026-08-02: it shared BW-COHORT- with `cohort`,
    // so no subject id could ever resolve to it.
    expect(doc.subject_kinds as readonly string[]).not.toContain("fund_cohort");
  });

  it("names the derivation source rather than a hand-written label", () => {
    expect(doc.derived_from).toContain("ARTIFACT_RENDER_CAPABILITY");
  });

  it("keeps unimplemented kinds out of the advertised pairs", () => {
    for (const kind of Object.keys(UNIMPLEMENTED_SUBJECT_KINDS)) {
      expect(
        doc.pairs.some((p) => p.subject_kind === (kind as ArtifactSubjectKind)),
      ).toBe(false);
    }
  });
});
