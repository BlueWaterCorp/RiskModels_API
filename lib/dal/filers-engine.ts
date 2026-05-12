/**
 * 13F Filers DAL — Supabase reads against `public.filers` and
 * `public.filer_portfolios_latest`. Mirrors `lib/dal/funds-engine.ts`.
 *
 * Per BWMACRO/docs/13f_pipeline_plan.md §7.4. Cohort axis differs from
 * funds: filers partition by `filer_type × aum_tier`, not `equity_style_9box`.
 * The portfolio-derived `dominant_9box` from the style-attribution kernel
 * lives on `filer_portfolios_latest` as a *portfolio* characterization,
 * not an entity-level taxonomy.
 *
 * Schema-ready columns the writer doesn't populate yet (Phase 2 returns,
 * Phase 1.5 style attribution before D.8.3 kernel ships) read as null —
 * snapshot composer renders them as "data unavailable" rather than
 * synthesizing values.
 */

import { createAdminClient } from "@/lib/supabase/admin";

export interface FilerRow {
  bw_filer_id: string;
  cik: string | null;
  lei: string | null;
  name: string | null;
  filer_type: string | null;
  filer_subtype: string | null;
  country: string | null;
  status: string | null;
  style_label: string | null;
  factset_entity_id: string | null; // licensed-id-ok: AUDIT-PENDING — public.filers column read into the DAL; D.8 license review pending whether this field is surfaced in /api/13f/filers responses
  latest_report_date: string | null;
  latest_filing_date: string | null;
  latest_extracted_at: string | null;
  latest_aum_usd: number | null;
  aum_tier: string | null;
  latest_n_holdings: number | null;
  last_in_eligible_universe_at: string | null;
  /** Cross-link from filer_master ↔ fund_master adviser_bw_filer_id (D.8.6). */
  n_funds_managed: number | null;
  metadata: Record<string, unknown> | null;
}

export interface FilerPortfolioLatestRow {
  bw_filer_id: string;
  report_date: string;
  filing_date: string;
  extracted_at: string;
  // Returns — NULL on filer side until Phase 2 (the security-master ↔ ERM3 bridge wired).
  portfolio_gross_return: number | null;
  portfolio_market_return: number | null;
  portfolio_sector_return: number | null;
  portfolio_subsector_return: number | null;
  portfolio_idiosyncratic_return: number | null;
  identity_residual: number | null;
  // Diagnostics
  weight_sum: number | null;
  n_holdings_active: number | null;
  effective_n: number | null;
  top10_weight_sum: number | null;
  // AUM
  total_aum_usd: number | null;
  // Cohort denormalization (filer axis = filer_type × aum_tier)
  filer_type: string | null;
  aum_tier: string | null;
  // Style attribution (D.8.6 columns; populated post-D.8.3 kernel)
  portfolio_9box_distribution: Record<string, number> | null;
  dominant_9box: string | null;
  portfolio_style_hhi: number | null;
  effective_n_styles: number | null;
  coverage_in_erm3: number | null;
  aum_in_erm3: number | null;
  n_holdings_in_erm3: number | null;
  effective_n_in_erm3: number | null;
  is_modelable: boolean | null;
  // Lineage
  model_version: string | null;
  factor_set_id: string | null;
  last_synced_at: string;
  metadata: Record<string, unknown> | null;
}

export interface FilerWithLatest {
  filer: FilerRow;
  latest: FilerPortfolioLatestRow | null;
}

export interface SearchFilersOptions {
  q?: string;
  filerType?: string | null;
  aumTier?: string | null;
  modelableOnly?: boolean;
  limit?: number;
}

const FILER_COLUMNS =
  "bw_filer_id, cik, lei, name, filer_type, filer_subtype, country, status, style_label, factset_entity_id, latest_report_date, latest_filing_date, latest_extracted_at, latest_aum_usd, aum_tier, latest_n_holdings, last_in_eligible_universe_at, n_funds_managed, metadata"; // licensed-id-ok: AUDIT-PENDING — column-select string; see the FilerRow.factset_entity_id note above

const FILER_LATEST_COLUMNS =
  "bw_filer_id, report_date, filing_date, extracted_at, portfolio_gross_return, portfolio_market_return, portfolio_sector_return, portfolio_subsector_return, portfolio_idiosyncratic_return, identity_residual, weight_sum, n_holdings_active, effective_n, top10_weight_sum, total_aum_usd, filer_type, aum_tier, portfolio_9box_distribution, dominant_9box, portfolio_style_hhi, effective_n_styles, coverage_in_erm3, aum_in_erm3, n_holdings_in_erm3, effective_n_in_erm3, is_modelable, model_version, factor_set_id, last_synced_at, metadata";

export async function fetchFiler(bwFilerId: string): Promise<FilerRow | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("filers")
      .select(FILER_COLUMNS)
      .eq("bw_filer_id", bwFilerId)
      .maybeSingle();
    if (error) {
      console.error(`[Filers DAL] Error fetching filer ${bwFilerId}:`, error);
      return null;
    }
    return (data as FilerRow | null) ?? null;
  } catch (error) {
    console.error(`[Filers DAL] Error fetching filer ${bwFilerId}:`, error);
    return null;
  }
}

export async function fetchFilerLatest(
  bwFilerId: string,
): Promise<FilerPortfolioLatestRow | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("filer_portfolios_latest")
      .select(FILER_LATEST_COLUMNS)
      .eq("bw_filer_id", bwFilerId)
      .maybeSingle();
    if (error) {
      console.error(
        `[Filers DAL] Error fetching filer_portfolios_latest ${bwFilerId}:`,
        error,
      );
      return null;
    }
    return (data as FilerPortfolioLatestRow | null) ?? null;
  } catch (error) {
    console.error(
      `[Filers DAL] Error fetching filer_portfolios_latest ${bwFilerId}:`,
      error,
    );
    return null;
  }
}

export async function resolveFilerById(
  bwFilerId: string,
): Promise<FilerWithLatest | null> {
  const [filer, latest] = await Promise.all([
    fetchFiler(bwFilerId),
    fetchFilerLatest(bwFilerId),
  ]);
  if (!filer) return null;
  return { filer, latest };
}

export async function resolveFilersByIds(
  bwFilerIds: string[],
): Promise<Map<string, FilerWithLatest>> {
  const result = new Map<string, FilerWithLatest>();
  if (bwFilerIds.length === 0) return result;

  try {
    const admin = createAdminClient();
    const [filersRes, latestRes] = await Promise.all([
      admin.from("filers").select(FILER_COLUMNS).in("bw_filer_id", bwFilerIds),
      admin
        .from("filer_portfolios_latest")
        .select(FILER_LATEST_COLUMNS)
        .in("bw_filer_id", bwFilerIds),
    ]);

    if (filersRes.error) {
      console.error("[Filers DAL] Batch filers error:", filersRes.error);
      return result;
    }

    const latestById = new Map<string, FilerPortfolioLatestRow>();
    if (!latestRes.error) {
      for (const row of (latestRes.data ?? []) as FilerPortfolioLatestRow[]) {
        latestById.set(row.bw_filer_id, row);
      }
    } else {
      console.error(
        "[Filers DAL] Batch filer_portfolios_latest error:",
        latestRes.error,
      );
    }

    for (const filer of (filersRes.data ?? []) as FilerRow[]) {
      result.set(filer.bw_filer_id, {
        filer,
        latest: latestById.get(filer.bw_filer_id) ?? null,
      });
    }
    return result;
  } catch (error) {
    console.error("[Filers DAL] Error in resolveFilersByIds:", error);
    return result;
  }
}

export async function searchFilers(
  options: SearchFilersOptions = {},
): Promise<FilerRow[]> {
  const { q, filerType, aumTier, modelableOnly, limit = 50 } = options;
  const safeLimit = Math.min(Math.max(limit, 1), 500);

  try {
    const admin = createAdminClient();
    let query = admin.from("filers").select(FILER_COLUMNS);

    if (q && q.trim().length > 0) {
      const escaped = q.trim().replace(/[%,()]/g, " ");
      query = query.or(
        `name.ilike.%${escaped}%,cik.ilike.%${escaped}%,lei.ilike.%${escaped}%`,
      );
    }
    if (filerType) {
      query = query.eq("filer_type", filerType);
    }
    if (aumTier) {
      query = query.eq("aum_tier", aumTier);
    }

    query = query
      .order("latest_aum_usd", { ascending: false, nullsFirst: false })
      .limit(safeLimit);

    const { data, error } = await query;
    if (error) {
      console.error("[Filers DAL] searchFilers error:", error);
      return [];
    }

    let rows = (data ?? []) as FilerRow[];

    // modelableOnly is a JOIN-style filter. Cheapest path: post-fetch via
    // a second query against filer_portfolios_latest. Acceptable scale —
    // search caps at 500 rows.
    if (modelableOnly && rows.length > 0) {
      const ids = rows.map((r) => r.bw_filer_id);
      const { data: modelableRows, error: modErr } = await admin
        .from("filer_portfolios_latest")
        .select("bw_filer_id")
        .in("bw_filer_id", ids)
        .eq("is_modelable", true);
      if (modErr) {
        console.error(
          "[Filers DAL] searchFilers modelable filter error:",
          modErr,
        );
        return rows;
      }
      const keep = new Set(
        (modelableRows ?? []).map((r) => (r as { bw_filer_id: string }).bw_filer_id),
      );
      rows = rows.filter((r) => keep.has(r.bw_filer_id));
    }
    return rows;
  } catch (error) {
    console.error("[Filers DAL] searchFilers error:", error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Cohort tables — filer_rankings_top
// ---------------------------------------------------------------------------

export type FilerPartitionType = "filer_type" | "aum_tier";

export interface FilerRankingRow {
  partition_type: FilerPartitionType;
  partition_value: string;
  bw_filer_id: string;
  metric: string;
  period_window: string;
  report_date: string;
  filing_date_max: string | null;
  rank: number;
  value: number | null;
  cohort_size: number | null;
}

const FILER_RANKING_COLUMNS =
  "partition_type, partition_value, bw_filer_id, metric, period_window, report_date, filing_date_max, rank, value, cohort_size";

/**
 * All rank entries for one filer across its cohort partitions
 * (filer_type and/or aum_tier). One row per (partition × metric ×
 * period_window). Returns [] if the filer has no rank coverage yet.
 */
export async function fetchFilerRanks(
  bwFilerId: string,
): Promise<FilerRankingRow[]> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("filer_rankings_top")
      .select(FILER_RANKING_COLUMNS)
      .eq("bw_filer_id", bwFilerId)
      .order("partition_type", { ascending: true })
      .order("metric", { ascending: true })
      .order("period_window", { ascending: true });
    if (error) {
      console.error("[Filers DAL] fetchFilerRanks error:", error);
      return [];
    }
    return (data ?? []) as FilerRankingRow[];
  } catch (error) {
    console.error("[Filers DAL] fetchFilerRanks error:", error);
    return [];
  }
}

export interface FetchFilerRankingsOptions {
  partitionType: FilerPartitionType;
  partitionValue: string;
  metric: string;
  periodWindow?: string;
  limit?: number;
}

/**
 * Top-N filers within one (partition_type, partition_value) cohort on a
 * given metric × period_window. Always sorted by rank ascending. Cap at 50.
 */
export async function fetchFilerRankings(
  options: FetchFilerRankingsOptions,
): Promise<FilerRankingRow[]> {
  const { partitionType, partitionValue, metric, periodWindow = "1m", limit = 25 } =
    options;
  const safeLimit = Math.min(Math.max(limit, 1), 50);

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("filer_rankings_top")
      .select(FILER_RANKING_COLUMNS)
      .eq("partition_type", partitionType)
      .eq("partition_value", partitionValue)
      .eq("metric", metric)
      .eq("period_window", periodWindow)
      .order("rank", { ascending: true })
      .limit(safeLimit);
    if (error) {
      console.error("[Filers DAL] fetchFilerRankings error:", error);
      return [];
    }
    return (data ?? []) as FilerRankingRow[];
  } catch (error) {
    console.error("[Filers DAL] fetchFilerRankings error:", error);
    return [];
  }
}
