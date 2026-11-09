/**
 * `returns` payload of POST /batch/analyze — parallel daily arrays built from
 * pivoted V3 history rows.
 *
 * A missing cell (masked session, unavailable hedge ratio, absent return) is
 * `null`, never 0: a 0 hedge ratio or a 0 return is a real value a consumer
 * would trade or compound on (RMAPI-30).
 */
import type { PivotedHistoryRow } from "@/lib/dal/risk-engine-v3";

export interface BatchReturnsPayload {
  dates: string[];
  values: (number | null)[];
  /** @deprecated Prefer `l3_market_hr` — orthogonal L3 market-leg HR history. */
  l1: (number | null)[];
  /** @deprecated Prefer `l3_sector_hr`. */
  l2: (number | null)[];
  /** @deprecated Prefer `l3_subsector_hr`. */
  l3: (number | null)[];
  l3_market_hr: (number | null)[];
  l3_sector_hr: (number | null)[];
  l3_subsector_hr: (number | null)[];
}

function cell(row: PivotedHistoryRow, key: string): number | null {
  const v = row[key];
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function batchReturnsFromPivoted(rows: PivotedHistoryRow[]): BatchReturnsPayload {
  const mkt = rows.map((p) => cell(p, "l3_mkt_hr"));
  const sec = rows.map((p) => cell(p, "l3_sec_hr"));
  const sub = rows.map((p) => cell(p, "l3_sub_hr"));
  return {
    dates: rows.map((p) => p.teo),
    values: rows.map((p) => cell(p, "returns_gross")),
    l1: mkt,
    l2: sec,
    l3: sub,
    l3_market_hr: [...mkt],
    l3_sector_hr: [...sec],
    l3_subsector_hr: [...sub],
  };
}
