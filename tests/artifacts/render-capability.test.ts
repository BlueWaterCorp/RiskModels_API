/**
 * Guards on the audited capability table.
 *
 * These exist because the failure they prevent is invisible: the old per-slug
 * matrix advertised `fund` and `client_portfolio` for `top_holdings_erm_stacked`
 * while both rendered an empty stacked bar with HTTP 200. Nothing failed, no
 * test caught it, and only rendering one by hand showed it. So the invariant
 * under test is not "the list is correct" but "the list cannot claim more than
 * was verified".
 */

import { describe, expect, it } from "vitest";

import {
  ARTIFACT_RENDER_CAPABILITY,
  ARTIFACT_SUBJECT_KINDS,
  DEGRADED_ARTIFACT_PAIRS,
  PRERENDERED_SUBJECT_KINDS,
  WIRED_ARTIFACT_RENDER_MATRIX,
  subjectKindOf,
} from "@/lib/artifacts/render-client";

describe("ARTIFACT_RENDER_CAPABILITY", () => {
  it("only ever advertises verified pairs", () => {
    for (const [slug, kinds] of Object.entries(WIRED_ARTIFACT_RENDER_MATRIX)) {
      for (const kind of kinds.subject_kinds) {
        expect(
          ARTIFACT_RENDER_CAPABILITY[slug]?.[kind as keyof (typeof ARTIFACT_RENDER_CAPABILITY)[string]]
            ?.status,
          `${slug}/${kind} is advertised but not verified`,
        ).toBe("verified");
      }
    }
  });

  it("never advertises a degraded pair", () => {
    for (const { slug, subject_kind } of DEGRADED_ARTIFACT_PAIRS) {
      expect(
        WIRED_ARTIFACT_RENDER_MATRIX[slug]?.subject_kinds ?? [],
        `${slug}/${subject_kind} renders empty and must not be advertised`,
      ).not.toContain(subject_kind);
    }
  });

  it("requires a reason for anything not verified", () => {
    for (const [slug, byKind] of Object.entries(ARTIFACT_RENDER_CAPABILITY)) {
      for (const [kind, cap] of Object.entries(byKind)) {
        if (cap && cap.status !== "verified") {
          expect(cap.reason?.length, `${slug}/${kind} has no reason`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("uses only known subject kinds", () => {
    for (const byKind of Object.values(ARTIFACT_RENDER_CAPABILITY)) {
      for (const kind of Object.keys(byKind)) {
        expect(ARTIFACT_SUBJECT_KINDS).toContain(kind);
      }
    }
  });

  it("drops slugs with no verified kind from the flat view", () => {
    // narrative_* are recorded as unavailable, so they must not appear.
    expect(WIRED_ARTIFACT_RENDER_MATRIX.narrative_profile).toBeUndefined();
    expect(WIRED_ARTIFACT_RENDER_MATRIX.position_cumulative_decomposition).toBeUndefined();
    // ...but they stay in the capability table, so a later audit sees the history.
    expect(ARTIFACT_RENDER_CAPABILITY.narrative_profile.fund?.status).toBe("unavailable");
  });

  it("has no degraded pairs left — the fund gap was fixed in prod 2026-08-01", () => {
    // Kept as a live assertion rather than deleted: DEGRADED_ARTIFACT_PAIRS is
    // the mechanism that keeps a 200-but-empty pair out of the advertised list,
    // so it must stay wired even when empty. If a future audit adds one, the
    // "never advertises a degraded pair" test above is what enforces it.
    expect(DEGRADED_ARTIFACT_PAIRS).toEqual([]);
  });

  it("advertises the fund and portfolio pairs that prod actually serves", () => {
    expect(WIRED_ARTIFACT_RENDER_MATRIX.top_holdings_erm_stacked.subject_kinds).toEqual(
      expect.arrayContaining(["fund", "client_portfolio", "filer_13f"]),
    );
  });
});

describe("subjectKindOf", () => {
  it("mirrors render-svc's prefix table, including etf", () => {
    expect(subjectKindOf("BW-FUND-S000004310")).toBe("fund");
    expect(subjectKindOf("BW-ETF-SPY")).toBe("etf");
    expect(subjectKindOf("BW-FILER-0001067983")).toBe("filer_13f");
    expect(subjectKindOf("BW-COHORT-RES-MAG7")).toBe("cohort");
    expect(subjectKindOf("BW-STOCK-NVDA")).toBe("stock");
    expect(subjectKindOf("BW-PORTFOLIO-abc123")).toBe("client_portfolio");
    expect(subjectKindOf("AAPL")).toBeNull();
  });

  it("resolves the shared BW-COHORT- prefix to cohort, not fund_cohort", () => {
    // fund_cohort is a UI-level distinction with no server-side identity.
    expect(subjectKindOf("BW-COHORT-RES-13F5")).toBe("cohort");
  });
});

describe("filerIdForm", () => {
  it("records where each filer slug's objects are stored, without resolving", () => {
    // Resolution lives in render-svc (filer_ids.py, Risk_Models #296). This
    // table only documents the storage form, so the assertion is about the
    // record being present and honest — not about rewriting anything.
    expect(ARTIFACT_RENDER_CAPABILITY.nav_composition_dual.filer_13f?.filerIdForm).toBe("cik");
    expect(ARTIFACT_RENDER_CAPABILITY.entity_header.filer_13f?.filerIdForm).toBe("bare");
  });

  it("exports no client-side id resolver", async () => {
    // Guard against the shim coming back. Two maps for one identity is the
    // C.13 failure; this file must not become the second one.
    const mod = await import("@/lib/artifacts/render-client");
    expect(mod).not.toHaveProperty("normalizeFilerSubjectId");
    expect(mod).not.toHaveProperty("ALT_FILER_SUBJECT_ID_SLUGS");
  });
});

describe("PRERENDERED_SUBJECT_KINDS", () => {
  it("covers the kinds render-svc cannot build on demand", () => {
    expect([...PRERENDERED_SUBJECT_KINDS].sort()).toEqual(["cohort", "filer_13f"]);
  });
});
