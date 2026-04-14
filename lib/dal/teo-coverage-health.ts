/**
 * Latest-session (T) gross-return coverage for health / agent signals.
 *
 * At the newest `teo` with `returns_gross` rows, measure how many universe
 * stocks have non-null values. Sparse coverage usually means the latest session
 * is still backfilling.
 */

import { createAdminClient } from "@/lib/supabase/admin";

/** Below this non-null / universe ratio, treat the latest session as still filling (10%). */
const SPARSE_COVERAGE_RATIO = 0.1;

export interface TeoCoverageHealth {
  latest_teo: string | null;
  universe_stock_count: number;
  non_null_returns_symbol_count: number;
  /** Percent of universe stocks with non-null `returns_gross` at `latest_teo`, 0–100; null if unknown. */
  latest_teo_coverage_pct: number | null;
  /** True when coverage ratio is below 10% — typical when same-day EOD is still filling in. */
  latest_session_returns_pending: boolean;
  query_error?: string;
}

export async function getTeoCoverageHealth(): Promise<TeoCoverageHealth> {
  const admin = createAdminClient();

  const { data: latestRow, error: latestErr } = await admin
    .from("security_history")
    .select("teo")
    .eq("periodicity", "daily")
    .eq("metric_key", "returns_gross")
    .order("teo", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { count: universeHead } = await admin
    .from("symbols")
    .select("*", { count: "exact", head: true })
    .eq("asset_type", "stock");

  const universeStock = universeHead ?? 0;

  if (latestErr) {
    return {
      latest_teo: null,
      universe_stock_count: universeStock,
      non_null_returns_symbol_count: 0,
      latest_teo_coverage_pct: null,
      latest_session_returns_pending: false,
      query_error: latestErr.message,
    };
  }

  const latestTeo = latestRow?.teo ?? null;
  if (!latestTeo) {
    return {
      latest_teo: null,
      universe_stock_count: universeStock,
      non_null_returns_symbol_count: 0,
      latest_teo_coverage_pct: null,
      latest_session_returns_pending: false,
    };
  }

  const { count: nonNullCount, error: countErr } = await admin
    .from("security_history")
    .select("*", { count: "exact", head: true })
    .eq("periodicity", "daily")
    .eq("metric_key", "returns_gross")
    .eq("teo", latestTeo)
    .not("metric_value", "is", null);

  if (countErr) {
    return {
      latest_teo: latestTeo,
      universe_stock_count: universeStock,
      non_null_returns_symbol_count: 0,
      latest_teo_coverage_pct: null,
      latest_session_returns_pending: false,
      query_error: countErr.message,
    };
  }

  const n = nonNullCount ?? 0;
  const u = universeStock;
  const ratio = u > 0 ? n / u : 0;
  const latest_teo_coverage_pct =
    u > 0 ? Math.round(ratio * 10000) / 100 : null;

  return {
    latest_teo: latestTeo,
    universe_stock_count: u,
    non_null_returns_symbol_count: n,
    latest_teo_coverage_pct,
    latest_session_returns_pending: u > 0 && ratio < SPARSE_COVERAGE_RATIO,
  };
}
