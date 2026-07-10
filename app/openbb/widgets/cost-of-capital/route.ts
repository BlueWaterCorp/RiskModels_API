/**
 * Live widget data endpoint: latest-quarter cost of capital → OpenBB
 * metric/value table.
 *
 * GET /openbb/widgets/cost-of-capital?ticker=AAPL&erp=0.05&rf_tenor=10y&tax_rate=0.21
 * Auth: X-API-KEY header, forwarded upstream as Bearer. Maps the real
 * /fundamentals/{ticker} cost-of-capital fields for the latest PIT-visible
 * quarter. ERP is always caller-supplied (widget param) — no ERP opinion is
 * stored upstream. beta_market is a short-half-life CONDITIONAL beta: for
 * defensive names cost of equity can sit below the risk-free rate (a property
 * of the conditional beta, not an error). WACC uses book-value weights.
 */
import { NextRequest, NextResponse } from "next/server";
import { metricsConnectProbe } from "../../_lib/connect-probe";
import { openbbCors } from "../../_lib/cors";
import { bearerFromRequest, upstreamGet } from "../../_lib/upstream";

export const dynamic = "force-dynamic";

type Row = { metric: string; value: string };

type FundamentalsRow = {
  period_end_date?: string;
  filed_date?: string | null;
  beta_market?: number | null;
  beta_source?: string | null;
  rf_rate?: number | null;
  cost_of_equity?: number | null;
  cost_of_debt?: number | null;
  wacc?: number | null;
  economic_profit?: number | null;
  roe_ttm?: number | null;
  sustainable_growth?: number | null;
};

function pct2(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? `${(n * 100).toFixed(2)}%` : "—";
}

function num2(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : "—";
}

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

export async function GET(req: NextRequest) {
  const cors = openbbCors(req);
  const sp = req.nextUrl.searchParams;
  const ticker = (sp.get("ticker") || "AAPL").trim().toUpperCase();
  const erp = (sp.get("erp") || "0.05").trim();
  const rfTenor = (sp.get("rf_tenor") || "10y").trim();
  const taxRate = (sp.get("tax_rate") || "0.21").trim();

  const key = bearerFromRequest(req);
  if (!key) {
    return NextResponse.json(metricsConnectProbe(), { headers: cors });
  }

  const qs = new URLSearchParams({
    periods: "1",
    erp,
    rf_tenor: rfTenor,
    tax_rate: taxRate,
  });
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

  const d = body as { ticker?: string; rows?: FundamentalsRow[] };
  const r = d.rows?.[d.rows.length - 1];
  if (!r) {
    return NextResponse.json(
      [{ metric: "Status", value: "No PIT-visible quarter for this ticker" }],
      { headers: cors },
    );
  }

  const rows: Row[] = [
    { metric: "Ticker", value: d.ticker ?? ticker },
    { metric: "Period end", value: r.period_end_date ?? "—" },
    { metric: "Filed", value: r.filed_date ?? "—" },
    { metric: `Risk-free rate (${rfTenor} CMT)`, value: pct2(r.rf_rate) },
    { metric: "ERP (caller-supplied)", value: pct2(Number(erp)) },
    { metric: "Market beta (conditional)", value: num2(r.beta_market) },
    { metric: "Beta source", value: String(r.beta_source ?? "—") },
    { metric: "Cost of equity", value: pct2(r.cost_of_equity) },
    { metric: "Cost of debt", value: pct2(r.cost_of_debt) },
    { metric: "WACC (book weights)", value: pct2(r.wacc) },
    { metric: "Economic profit (TTM)", value: money(r.economic_profit) },
    { metric: "ROE (TTM)", value: pct2(r.roe_ttm) },
    { metric: "Sustainable growth", value: pct2(r.sustainable_growth) },
    {
      metric: "Note",
      value:
        "Conditional beta — CoE below the risk-free rate is possible for defensives. WACC uses book weights.",
    },
  ];

  return NextResponse.json(rows, { headers: cors });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: openbbCors(req),
  });
}
