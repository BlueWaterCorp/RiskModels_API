/**
 * PostgREST filters for balance-backed API charges (excludes H.20 telemetry
 * shadow rows: default type=debit, cost_usd=0, no balance_after_usd).
 *
 * Args/return are `any` — Supabase PostgrestFilterBuilder generics exceed TS
 * recursion limits when chained (.in, .gte, etc.).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyChargeDebitFilters(query: any): any {
  return query.eq("type", "debit").gt("cost_usd", 0);
}

/** Request telemetry rows (one per API call; not balance debits). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyTelemetryFilters(query: any): any {
  return query.not("latency_ms", "is", null);
}
