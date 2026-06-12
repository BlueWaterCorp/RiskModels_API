/**
 * Risk Calendar (T.6) — unified event query over `risk_events` (earnings /
 * ex-dividend / macro, maintained by the ERM3 publish_risk_events asset)
 * plus `filing_calendar` (SEC deadlines, maintained by publish_filing_calendar),
 * unioned at this layer so the two pipeline tables never duplicate rows.
 *
 * Portfolio awareness: callers pass the user's tickers; macro and filing
 * events always apply. `coverage` reports which requested tickers exist
 * anywhere in the events table (the pipeline covers the top-1500-by-mcap
 * universe) — an uncovered holding is surfaced explicitly rather than
 * silently showing no events.
 *
 * `hist_move_pct` is a REALIZED stat (median |1-day| move over the last
 * `hist_move_n` earnings reports) — never present it as an implied or
 * expected move.
 */

import { createAdminClient } from "@/lib/supabase/admin";

export type RiskCalendarEventType =
  | "earnings"
  | "ex_dividend"
  | "macro"
  | "filing_deadline";

export interface RiskCalendarEvent {
  event_date: string;
  event_type: RiskCalendarEventType;
  entity_id: string;
  ticker: string | null;
  macro_tag: string | null;
  title: string;
  before_after_market: string | null;
  estimate: number | null;
  actual: number | null;
  previous: number | null;
  dividend_amount: number | null;
  currency: string | null;
  hist_move_pct: number | null;
  hist_move_n: number | null;
  risk_layers: string[];
  source: string;
}

export interface RiskCalendarCoverage {
  requested: string[];
  covered: string[];
  /** Holdings with no presence in the events table — outside the published universe. */
  uncovered: string[];
}

export interface RiskCalendarResult {
  events: RiskCalendarEvent[];
  window: { from: string; to: string };
  coverage?: RiskCalendarCoverage;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

function normalizeTickers(tickers: string[] | undefined): string[] {
  if (!tickers?.length) return [];
  const out = new Set<string>();
  for (const t of tickers) {
    const u = String(t).trim().toUpperCase();
    if (TICKER_RE.test(u)) out.add(u);
  }
  return [...out];
}

export async function getRiskCalendar(opts: {
  from?: string;
  to?: string;
  tickers?: string[];
  types?: RiskCalendarEventType[];
  includeFilings?: boolean;
}): Promise<RiskCalendarResult> {
  const today = new Date();
  const from = opts.from ?? isoDate(today);
  const to =
    opts.to ?? isoDate(new Date(today.getTime() + 30 * 24 * 3600 * 1000));
  const tickers = normalizeTickers(opts.tickers);
  const types = opts.types?.length ? opts.types : undefined;
  const includeFilings =
    (opts.includeFilings ?? true) &&
    (!types || types.includes("filing_deadline"));

  const supabase = createAdminClient();

  let query = supabase
    .from("risk_events")
    .select(
      "event_date,event_type,entity_id,ticker,macro_tag,title,before_after_market,estimate,actual,previous,dividend_amount,currency,hist_move_pct,hist_move_n,risk_layers,source",
    )
    .gte("event_date", from)
    .lte("event_date", to)
    .order("event_date", { ascending: true });

  if (types) {
    query = query.in(
      "event_type",
      types.filter((t) => t !== "filing_deadline"),
    );
  }
  if (tickers.length > 0) {
    // Ticker events scoped to the portfolio; macro events always apply.
    query = query.or(
      `ticker.in.(${tickers.join(",")}),event_type.eq.macro`,
    );
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`risk_events query failed: ${error.message}`);
  }
  const events: RiskCalendarEvent[] = (data ?? []) as RiskCalendarEvent[];

  if (includeFilings) {
    const { data: filings, error: filingsError } = await supabase
      .from("filing_calendar")
      .select("form_type,period_label,period_end,due_date,is_universal,category")
      .gte("due_date", from)
      .lte("due_date", to)
      .order("due_date", { ascending: true });
    if (filingsError) {
      throw new Error(`filing_calendar query failed: ${filingsError.message}`);
    }
    for (const f of filings ?? []) {
      events.push({
        event_date: f.due_date,
        event_type: "filing_deadline",
        entity_id: `${f.form_type}:${f.period_end}`,
        ticker: null,
        macro_tag: null,
        title: `${f.form_type} filing deadline (${f.period_label})`,
        before_after_market: null,
        estimate: null,
        actual: null,
        previous: null,
        dividend_amount: null,
        currency: null,
        hist_move_pct: null,
        hist_move_n: null,
        risk_layers: [],
        source: "filing_calendar",
      });
    }
    events.sort((a, b) => a.event_date.localeCompare(b.event_date));
  }

  const result: RiskCalendarResult = { events, window: { from, to } };

  if (tickers.length > 0) {
    // Coverage is checked against the whole table (window-independent):
    // the pipeline always holds ≥1 earnings row per covered ticker.
    const { data: cov, error: covError } = await supabase
      .from("risk_events")
      .select("ticker")
      .in("ticker", tickers);
    if (!covError) {
      const covered = [
        ...new Set((cov ?? []).map((r) => r.ticker as string)),
      ].sort();
      const coveredSet = new Set(covered);
      result.coverage = {
        requested: tickers,
        covered,
        uncovered: tickers.filter((t) => !coveredSet.has(t)).sort(),
      };
    }
  }

  return result;
}
