import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";

vi.mock("@/lib/agent/billing-middleware", () => ({
  withBilling: <T extends (...args: unknown[]) => unknown>(handler: T) => handler,
}));

vi.mock("@/lib/dal/filers-engine", () => ({
  fetchFiler: vi.fn(),
  resolveFilerById: vi.fn(),
  fetchFilerRanks: vi.fn(),
}));

vi.mock("@/lib/dal/funds-zarr-reader", () => ({
  isSyntheticEntityId: (id: string) => id.startsWith("BW-SYNTH-"),
  readSyntheticEntityMeta: vi.fn(),
  readFilerHoldingsTopN: vi.fn(),
  readFilerPortfolioSeries: vi.fn(),
  readFilerReturnsDecomposition: vi.fn(),
  readFilerHedgeLatest: vi.fn(),
}));

vi.mock("@/lib/13f/enrich-filer-holdings", () => ({
  enrichFilerHoldingsWithL3: vi.fn(async (snap: unknown) => snap),
}));

import { fetchFiler, resolveFilerById, fetchFilerRanks } from "@/lib/dal/filers-engine";
import {
  readFilerHedgeLatest,
  readFilerHoldingsTopN,
  readFilerPortfolioSeries,
  readFilerReturnsDecomposition,
  readSyntheticEntityMeta,
  type SyntheticEntityMeta,
} from "@/lib/dal/funds-zarr-reader";
import type { BillingContext } from "@/lib/agent/billing-middleware";
import { loadFilerSnapshot } from "@/lib/13f/filer-snapshot-loader";
import { GET as holdingsGETWrapped } from "@/app/api/13f/filers/[bw_filer_id]/holdings/route";

type RouteGET = (
  req: NextRequest,
  ctx: BillingContext,
) => Promise<NextResponse>;
const holdingsGET = holdingsGETWrapped as unknown as RouteGET;

const SYNTH_ID = "BW-SYNTH-00000000-test";

const META: SyntheticEntityMeta = {
  teo: "2025-12-31",
  name: "test",
  recipe: {
    schema: "layered_portfolio_recipe/1",
    plan_id: "test",
    edges: [{ child_id: "BW-FILER-CIK0000000000", self_scaled: true }],
  },
  recipe_hash: "00000000",
  weight_basis: "static_mix/mandate_usd_as_disclosed",
  ontology_version: "2.0",
  layer_depth: 1,
  coverage: {
    mapped_weight_frac: 0.97,
    child_coverage: 1,
    effective_coverage: 0.9,
    n_children: 1,
  },
};

const HOLDINGS_SNAPSHOT = {
  teo: "2025-12-31",
  report_date: "2025-12-31",
  filing_date: null,
  as_of_basis: "report_date" as const,
  // Composites are assembled from many filers' panels — no single surviving
  // accession, so filing identity is null by construction, not by gap.
  accession_number: null,
  filing_type: null,
  amendment_type: null,
  total_aum_usd: null,
  aum_in_erm3: null,
  n_holdings_returned: 2,
  n_total_holdings: 42,
  holdings: [
    { security_id: "BW-A", adj_mv: 600, weight: 0.6 },
    { security_id: "BW-B", adj_mv: 400, weight: 0.4 },
  ],
};

function request(path: string): NextRequest {
  return new NextRequest(new URL(`http://localhost${path}`));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("holdings route — synthetic composite ids", () => {
  it("serves BW-SYNTH-* from the same route with additive fields and null registry fields", async () => {
    vi.mocked(readSyntheticEntityMeta).mockResolvedValue(META);
    vi.mocked(readFilerHoldingsTopN).mockResolvedValue(HOLDINGS_SNAPSHOT);

    const res = await holdingsGET(
      request(`/api/13f/filers/${SYNTH_ID}/holdings`),
      {} as BillingContext,
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.bw_filer_id).toBe(SYNTH_ID);
    expect(body.entity_kind).toBe("synthetic_composite");
    expect(body.evidence_class).toBe("reconstructed");
    expect(body.cik).toBeNull();
    expect(body.filer_type).toBeNull();
    expect(body.aum_tier).toBeNull();
    expect(body.name).toBe("test");
    expect(body.holdings).toHaveLength(2);
    expect(body.holdings[0].adj_mv).toBeGreaterThan(body.holdings[1].adj_mv);
    // registry is never consulted for synthetic ids
    expect(fetchFiler).not.toHaveBeenCalled();
  });

  it("404s an unknown synthetic id without touching the registry", async () => {
    vi.mocked(readSyntheticEntityMeta).mockResolvedValue(null);
    const res = await holdingsGET(
      request(`/api/13f/filers/BW-SYNTH-ffffffff-none/holdings`),
      {} as BillingContext,
    );
    expect(res.status).toBe(404);
    expect(fetchFiler).not.toHaveBeenCalled();
    expect(readFilerHoldingsTopN).not.toHaveBeenCalled();
  });

  it("keeps the BW-FILER response shape unchanged (no synthetic keys)", async () => {
    vi.mocked(fetchFiler).mockResolvedValue({
      bw_filer_id: "BW-FILER-CIK0000123456",
      cik: "0000123456",
      name: "Test Capital LP",
      filer_type: "hedge_fund",
      aum_tier: "large",
      latest_filing_date: "2026-05-14",
    } as never);
    vi.mocked(readFilerHoldingsTopN).mockResolvedValue({
      ...HOLDINGS_SNAPSHOT,
      filing_date: "2026-05-14",
      as_of_basis: "filing_date",
    });

    const res = await holdingsGET(
      request(`/api/13f/filers/BW-FILER-CIK0000123456/holdings`),
      {} as BillingContext,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toHaveProperty("entity_kind");
    expect(body).not.toHaveProperty("evidence_class");
    expect(body.cik).toBe("0000123456");
    expect(body.filer_type).toBe("hedge_fund");
    expect(body.aum_tier).toBe("large");
    expect(readSyntheticEntityMeta).not.toHaveBeenCalled();
  });
});

describe("snapshot loader — synthetic composite ids", () => {
  it("composes the same snapshot shape with additive synthetic fields", async () => {
    vi.mocked(readSyntheticEntityMeta).mockResolvedValue(META);
    vi.mocked(readFilerHoldingsTopN).mockResolvedValue(HOLDINGS_SNAPSHOT);
    vi.mocked(readFilerPortfolioSeries).mockResolvedValue([
      {
        teo: "2025-12-31",
        filing_date: null,
        weight_sum: 1,
        n_holdings_active: 42,
        effective_n: 12,
        top5_weight_sum: null,
        top10_weight_sum: 0.5,
        weight_hhi: null,
        total_aum_usd: null,
        aum_in_erm3: null,
        n_holdings_in_erm3: null,
        effective_n_in_erm3: null,
        coverage_in_erm3: null,
        portfolio_style_hhi: null,
        effective_n_styles: null,
        portfolio_gross_return: 0.01,
        portfolio_market_return: 0.008,
        portfolio_sector_return: 0.001,
        portfolio_subsector_return: 0.0005,
        portfolio_idiosyncratic_return: 0.0005,
        identity_residual: 0,
      },
    ]);
    vi.mocked(readFilerReturnsDecomposition).mockResolvedValue(null);
    vi.mocked(readFilerHedgeLatest).mockResolvedValue(null);

    const result = await loadFilerSnapshot(SYNTH_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const s = result.snapshot;
    expect(s.entity_kind).toBe("synthetic_composite");
    expect(s.evidence_class).toBe("reconstructed");
    expect(s.recipe).toEqual(META.recipe);
    expect(s.bw_filer_id).toBe(SYNTH_ID);
    // registry-only fields are null
    expect(s.cik).toBeNull();
    expect(s.filer_type).toBeNull();
    expect(s.aum_tier).toBeNull();
    expect(s.cohort_context).toBeNull();
    // composition coverage merged into the coverage block (erm3 keys retained)
    expect(s.coverage.effective_coverage).toBeCloseTo(0.9);
    expect(s.coverage.mapped_weight_frac).toBeCloseTo(0.97);
    expect(s.coverage.n_children).toBe(1);
    expect(s.coverage.coverage_in_erm3).toBeNull();
    // panel data flows through the shared readers
    expect(s.holdings?.top).toHaveLength(2);
    expect(s.portfolio_history.n_periods).toBe(1);
    expect(result.reportDate).toBe("2025-12-31");
    expect(result.filingDate).toBeNull();
    // no database dependency on the synthetic path
    expect(resolveFilerById).not.toHaveBeenCalled();
    expect(fetchFilerRanks).not.toHaveBeenCalled();
  });

  it("404s an unknown synthetic id", async () => {
    vi.mocked(readSyntheticEntityMeta).mockResolvedValue(null);
    const result = await loadFilerSnapshot("BW-SYNTH-ffffffff-none");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
    expect(resolveFilerById).not.toHaveBeenCalled();
  });

  it("leaves the BW-FILER snapshot free of synthetic keys", async () => {
    vi.mocked(resolveFilerById).mockResolvedValue({
      filer: {
        bw_filer_id: "BW-FILER-CIK0000123456",
        cik: "0000123456",
        lei: null,
        name: "Test Capital LP",
        filer_type: "hedge_fund",
        filer_subtype: null,
        country: "US",
        status: "active",
        style_label: null,
        factset_entity_id: null,
        latest_report_date: "2026-03-31",
        latest_filing_date: "2026-05-14",
        latest_extracted_at: null,
        latest_aum_usd: 1_000_000_000,
        aum_tier: "large",
        latest_n_holdings: 42,
        last_in_eligible_universe_at: null,
        n_funds_managed: null,
        metadata: null,
      },
      latest: null,
    });
    vi.mocked(fetchFilerRanks).mockResolvedValue([]);
    vi.mocked(readFilerHoldingsTopN).mockResolvedValue(null);
    vi.mocked(readFilerPortfolioSeries).mockResolvedValue([]);
    vi.mocked(readFilerReturnsDecomposition).mockResolvedValue(null);
    vi.mocked(readFilerHedgeLatest).mockResolvedValue(null);

    const result = await loadFilerSnapshot("BW-FILER-CIK0000123456");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.entity_kind).toBe("13f_filer");
    expect(result.snapshot).not.toHaveProperty("evidence_class");
    expect(result.snapshot).not.toHaveProperty("recipe");
    expect(result.snapshot.coverage).not.toHaveProperty("effective_coverage");
    expect(readSyntheticEntityMeta).not.toHaveBeenCalled();
  });
});
