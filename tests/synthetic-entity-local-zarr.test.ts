import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

/**
 * Local-zarr integration test for synthetic composite entities. Opt-in
 * (requires a local mirror of the funds zarr tree and a materialized
 * composite):
 *
 *   ZARR_FUNDS_LOCAL_ROOT=/path/to/zarr \
 *   SYNTH_ZARR_TEST_ID=BW-SYNTH-xxxxxxxx-slug \
 *   npx vitest run tests/synthetic-entity-local-zarr.test.ts
 *
 * Reads the real per-entity store (no fixtures). Supabase-backed
 * enrichment/scrub is identity-mocked so the test exercises the zarr
 * adapter offline.
 */

vi.mock("@/lib/dal/symbols-batch", () => ({
  applyScrubToHoldings: vi.fn(async (h: unknown) => h),
  applyScrubToFilerHoldings: vi.fn(async (h: unknown) => h),
}));

vi.mock("@/lib/13f/enrich-filer-holdings", () => ({
  enrichFilerHoldingsWithL3: vi.fn(async (snap: unknown) => snap),
}));

import {
  readFilerHoldingsTopN,
  readFilerPortfolioSeries,
  readSyntheticEntityMeta,
} from "@/lib/dal/funds-zarr-reader";
import { loadFilerSnapshot } from "@/lib/13f/filer-snapshot-loader";

const ROOT = process.env.ZARR_FUNDS_LOCAL_ROOT?.trim();
const SYNTH_ID = process.env.SYNTH_ZARR_TEST_ID?.trim();
const AVAILABLE =
  !!ROOT &&
  !!SYNTH_ID &&
  existsSync(`${ROOT}/bw_synth_id/${SYNTH_ID}/ds_ph.zarr/.zgroup`);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

describe.skipIf(!AVAILABLE)("synthetic composite — local zarr", () => {
  it("reads self-describing entity meta from ds_ph.zarr attrs", async () => {
    const meta = await readSyntheticEntityMeta(SYNTH_ID!);
    expect(meta).not.toBeNull();
    expect(meta!.teo).toMatch(ISO_DATE);
    expect(meta!.recipe).not.toBeNull();
    expect(typeof meta!.recipe).toBe("object");
    expect(meta!.recipe_hash).toBeTruthy();
    // recipe_hash is the hash8 component of the id
    expect(SYNTH_ID).toContain(meta!.recipe_hash!);
    expect(meta!.weight_basis).toBeTruthy();
    expect(meta!.ontology_version).toBeTruthy();
    const cov = meta!.coverage;
    expect(cov.effective_coverage).toBeGreaterThan(0);
    expect(cov.effective_coverage).toBeLessThanOrEqual(1);
    expect(cov.mapped_weight_frac).toBeGreaterThan(0);
    expect(cov.n_children).toBeGreaterThanOrEqual(1);
  });

  it("serves top-N holdings by adj_mv through the shared filer reader", async () => {
    const snap = await readFilerHoldingsTopN(SYNTH_ID!, 10);
    expect(snap).not.toBeNull();
    expect(snap!.teo).toMatch(ISO_DATE);
    expect(snap!.holdings.length).toBeGreaterThan(0);
    expect(snap!.holdings.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < snap!.holdings.length; i++) {
      expect(snap!.holdings[i - 1]!.adj_mv).toBeGreaterThanOrEqual(
        snap!.holdings[i]!.adj_mv,
      );
    }
    for (const h of snap!.holdings) {
      expect(h.adj_mv).toBeGreaterThan(0);
      expect(h.security_id).toBeTruthy();
      expect(h.weight).toBeGreaterThan(0);
    }
  });

  it("serves the portfolio series through the shared filer reader", async () => {
    const rows = await readFilerPortfolioSeries(SYNTH_ID!);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.teo).toMatch(ISO_DATE);
    }
  });

  it("composes the full snapshot with additive synthetic fields", async () => {
    const result = await loadFilerSnapshot(SYNTH_ID!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const s = result.snapshot;
    expect(s.entity_kind).toBe("synthetic_composite");
    expect(s.evidence_class).toBe("reconstructed");
    expect(s.recipe).not.toBeNull();
    expect(s.cik).toBeNull();
    expect(s.filer_type).toBeNull();
    expect(s.aum_tier).toBeNull();
    expect(s.coverage.effective_coverage).toBeGreaterThan(0);
    expect(s.coverage.n_children).toBeGreaterThanOrEqual(1);
    expect(s.holdings?.top.length).toBeGreaterThan(0);
    expect(result.reportDate).toMatch(ISO_DATE);
  });
});
