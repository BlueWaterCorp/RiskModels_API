/**
 * Live widget data endpoint: PIT quarterly fundamentals history → OpenBB table rows.
 *
 * GET /openbb/widgets/fundamentals-history?ticker=AAPL&periods=8&as_of=
 * Auth: X-API-KEY header (the OpenBB user's rm_agent_live_* key), forwarded
 * upstream as a Bearer token. Maps the real /fundamentals/{ticker} response —
 * rows are PIT-gated upstream (visible iff filed_date <= as_of). Raw dollar
 * line items come exclusively from the per-cell SEC-sourced sec_facts object
 * (columns suffixed "(SEC)"); a "—" in those columns means that cell is not
 * SEC-served for the period, not that it is zero. No synthetic values.
 */
import { NextRequest, NextResponse } from "next/server";
import { noKeyRows } from "../../_lib/connect-probe";
import { openbbCors } from "../../_lib/cors";
import { bearerFromRequest, upstreamGet } from "../../_lib/upstream";

export const dynamic = "force-dynamic";

type SecFact = { value?: number; source?: string };
type FundamentalsRow = {
  period_end_date?: string;
  filed_date?: string | null;
  filed_date_source?: string | null;
  sec_facts?: Record<string, SecFact>;
  roe_ttm?: number | null;
  fcf_margin?: number | null;
  leverage_ratio?: number | null;
  equity_bridge_residual?: number | null;
};

function money(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  return `${sign}$${a.toFixed(2)}`;
}

function pct1(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "—";
}

function num2(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : "—";
}

function sec(row: FundamentalsRow, concept: string): number | null {
  const f = row.sec_facts?.[concept];
  return typeof f?.value === "number" && Number.isFinite(f.value) ? f.value : null;
}

export async function GET(req: NextRequest) {
  const cors = openbbCors(req);
  const sp = req.nextUrl.searchParams;
  const ticker = (sp.get("ticker") || "AAPL").trim().toUpperCase();
  const periods = (sp.get("periods") || "8").trim();
  const asOf = (sp.get("as_of") || "").trim();

  const key = bearerFromRequest(req);
  if (!key) {
    return NextResponse.json(noKeyRows(), { headers: cors });
  }

  const qs = new URLSearchParams({ periods });
  if (asOf) qs.set("as_of", asOf);
  const { status, body } = await upstreamGet(
    `/fundamentals/${encodeURIComponent(ticker)}?${qs}`,
    key,
  );

  if (status < 200 || status >= 300) {
    const message =
      (body as { error?: string; message?: string })?.error ||
      (body as { message?: string })?.message ||
      `Upstream returned ${status}`;
    return NextResponse.json({ error: message }, { status, headers: cors });
  }

  const d = body as { rows?: FundamentalsRow[] };
  const rows = [...(d.rows ?? [])].reverse().map((r) => {
    const secServed = Object.keys(r.sec_facts ?? {}).length;
    return {
      period_end: r.period_end_date ?? "—",
      filed:
        (r.filed_date ?? "—") +
        (r.filed_date_source === "approx" ? " (approx)" : ""),
      revenue_sec: money(sec(r, "revenue")),
      net_income_sec: money(sec(r, "net_income")),
      eps_diluted_sec: num2(sec(r, "eps_diluted")),
      cfo_sec: money(sec(r, "cash_from_operations")),
      dividends_paid_sec: money(sec(r, "dividends_paid")),
      buybacks_sec: money(sec(r, "share_repurchases")),
      roe_ttm: pct1(r.roe_ttm),
      fcf_margin: pct1(r.fcf_margin),
      leverage: num2(r.leverage_ratio),
      sec_facts_served: secServed,
    };
  });

  return NextResponse.json(rows, { headers: cors });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: openbbCors(req),
  });
}
