/**
 * Read-time active-fund rule for list / search / ranking reads.
 *
 * `public.funds` carries every fund, dead and live. Whether a fund appears
 * in a listing is decided here, at read time, from lifecycle status plus
 * last-holdings availability. Nothing is ever deleted from the table.
 *
 * A fund is ACTIVE FOR LISTING when
 *   status = 'active'
 *   AND latest_report_date >= universe_latest_report_date - ACTIVE_LOOKBACK_DAYS
 * where universe_latest_report_date = max(latest_report_date) over
 * status = 'active' funds (cached per process with a short TTL).
 *
 * Direct lookups (by bw_fund_id or ticker) never apply this rule: a dead
 * fund's page still resolves and carries status / death_date /
 * latest_report_date.
 *
 * Fallback: when the lifecycle columns are absent (migration not applied)
 * or no row has status = 'active' yet (NULL status = unknown), the context
 * reports `filterEnabled: false` and listings behave as before (no filter).
 * The decision comes from a probe query, not a feature flag.
 */

import type { createAdminClient } from "@/lib/supabase/admin";

export const ACTIVE_LOOKBACK_DAYS = 400;

/** Lifecycle columns added to `public.funds` by the fund-master migration. */
export const FUND_LIFECYCLE_COLUMNS =
  "status, death_date, is_etf, is_etf_source, is_money_market";

export type FundLifecycleStatus = "active" | "delisted";

export interface FundLifecycleFields {
  status?: FundLifecycleStatus | string | null;
  death_date?: string | null;
  is_etf?: boolean | null;
  is_etf_source?: string | null;
  is_money_market?: boolean | null;
}

export interface ActiveFundFilterOptions {
  /** Return dead / stale / unknown-status funds too. Default false. */
  includeInactive?: boolean;
  /** Keep funds flagged is_etf = true. Default true. */
  includeEtfs?: boolean;
}

export interface FundListingContext {
  /** Lifecycle columns exist on `public.funds` and may be selected. */
  lifecycleColumnsPresent: boolean;
  /** Active rule is applied (columns present AND an active universe exists). */
  filterEnabled: boolean;
  /** max(latest_report_date) over status='active'; null when unknown. */
  universeLatestReportDate: string | null;
  /** universeLatestReportDate - ACTIVE_LOOKBACK_DAYS; null when unknown. */
  reportDateFloor: string | null;
}

type AdminClient = ReturnType<typeof createAdminClient>;

const CONTEXT_TTL_MS = 10 * 60 * 1000;
const FALLBACK_TTL_MS = 60 * 1000;

let cached: { ctx: FundListingContext; expiresAt: number } | null = null;

/** Test hook: drop the cached listing context. */
export function resetFundListingContextCache(): void {
  cached = null;
}

/** ISO date `days` before `isoDate` (UTC calendar arithmetic). */
export function activeReportDateFloor(
  isoDate: string,
  days: number = ACTIVE_LOOKBACK_DAYS,
): string {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function buildFundListingContext(
  lifecycleColumnsPresent: boolean,
  universeLatestReportDate: string | null,
): FundListingContext {
  const latest = lifecycleColumnsPresent ? universeLatestReportDate : null;
  return {
    lifecycleColumnsPresent,
    filterEnabled: lifecycleColumnsPresent && latest != null,
    universeLatestReportDate: latest,
    reportDateFloor: latest ? activeReportDateFloor(latest) : null,
  };
}

/**
 * Probe `public.funds` once per TTL: selecting `status` fails when the
 * migration has not landed; an empty result means no active universe yet.
 * Any error falls back to the unfiltered behaviour (short TTL).
 */
export async function getFundListingContext(
  admin: AdminClient,
): Promise<FundListingContext> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.ctx;

  let ctx: FundListingContext;
  let ttl = CONTEXT_TTL_MS;
  try {
    const { data, error } = await admin
      .from("funds")
      .select("status, latest_report_date")
      .eq("status", "active")
      .not("latest_report_date", "is", null)
      .order("latest_report_date", { ascending: false })
      .limit(1);
    if (error) {
      ctx = buildFundListingContext(false, null);
      ttl = FALLBACK_TTL_MS;
    } else {
      const rows = Array.isArray(data) ? data : data ? [data] : [];
      const first = rows[0] as { latest_report_date?: string | null } | undefined;
      ctx = buildFundListingContext(true, first?.latest_report_date ?? null);
      if (!ctx.filterEnabled) ttl = FALLBACK_TTL_MS;
    }
  } catch {
    ctx = buildFundListingContext(false, null);
    ttl = FALLBACK_TTL_MS;
  }
  cached = { ctx, expiresAt: now + ttl };
  return ctx;
}

/**
 * Pure form of the rule, for in-memory rows and tests. Mirrors
 * `applyActiveFundFilter` exactly.
 */
export function isFundActiveForListing(
  row: FundLifecycleFields & { latest_report_date?: string | null },
  ctx: FundListingContext,
  opts: ActiveFundFilterOptions = {},
): boolean {
  const { includeInactive = false, includeEtfs = true } = opts;
  if (ctx.lifecycleColumnsPresent && !includeEtfs && row.is_etf === true) {
    return false;
  }
  if (includeInactive || !ctx.filterEnabled) return true;
  if (row.status !== "active") return false;
  const d = row.latest_report_date;
  return d != null && ctx.reportDateFloor != null && d >= ctx.reportDateFloor;
}

/** Minimal PostgREST builder surface used by the filter. */
interface FilterableQuery {
  eq(column: string, value: unknown): FilterableQuery;
  gte(column: string, value: unknown): FilterableQuery;
  not(column: string, operator: string, value: unknown): FilterableQuery;
}

/**
 * Apply the active rule (and optional ETF exclusion) to a `funds` query.
 * Typed loosely on input to avoid deep generic instantiation over the
 * PostgREST builder; the builder's own type is returned unchanged.
 */
export function applyActiveFundFilter<Q>(
  query: Q,
  ctx: FundListingContext,
  opts: ActiveFundFilterOptions = {},
): Q {
  const { includeInactive = false, includeEtfs = true } = opts;
  let q = query as unknown as FilterableQuery;
  if (ctx.lifecycleColumnsPresent && !includeEtfs) {
    // NULL is_etf (unclassified) is kept; only confirmed ETFs are dropped.
    q = q.not("is_etf", "is", true);
  }
  if (!includeInactive && ctx.filterEnabled && ctx.reportDateFloor) {
    q = q.eq("status", "active").gte("latest_report_date", ctx.reportDateFloor);
  }
  return q as unknown as Q;
}

/** True when the rule would change a listing (skip extra lookups otherwise). */
export function activeFilterIsNoop(
  ctx: FundListingContext,
  opts: ActiveFundFilterOptions = {},
): boolean {
  const { includeInactive = false, includeEtfs = true } = opts;
  const etfNoop = includeEtfs || !ctx.lifecycleColumnsPresent;
  const activeNoop = includeInactive || !ctx.filterEnabled;
  return etfNoop && activeNoop;
}

/**
 * Parse `include_inactive` / `include_etfs` query params.
 * include_inactive: only "true" / "1" enables. include_etfs: only "false" / "0" disables.
 */
export function parseActiveFundQueryParams(
  searchParams: URLSearchParams,
): Required<ActiveFundFilterOptions> {
  const inactive = searchParams.get("include_inactive")?.trim().toLowerCase();
  const etfs = searchParams.get("include_etfs")?.trim().toLowerCase();
  return {
    includeInactive: inactive === "true" || inactive === "1",
    includeEtfs: !(etfs === "false" || etfs === "0"),
  };
}
