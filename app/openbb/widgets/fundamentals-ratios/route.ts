/**
 * Live widget data endpoint: TTM capital-return ratios over time → OpenBB
 * line-chart rows (chartView table).
 *
 * GET /openbb/widgets/fundamentals-ratios?ticker=AAPL&periods=16&as_of=
 * Auth: X-API-KEY header, forwarded upstream as Bearer. Maps the real
 * /fundamentals/{ticker} capital-return ratios (payout, retention, buyback,
 * total payout, sustainable growth — all TTM, cash-dividend basis). Ratios are
 * null upstream when trailing-4-quarter net income <= 0 (a payout on
 * non-positive earnings is not meaningful) — emitted as null so the chart
 * skips the point, never fabricated.
 */
import { NextRequest, NextResponse } from "next/server";
import { noKeyRows } from "../../_lib/connect-probe";
import { openbbCors } from "../../_lib/cors";
import { bearerFromRequest, upstreamGet } from "../../_lib/upstream";

export const dynamic = "force-dynamic";

type FundamentalsRow = {
  period_end_date?: string;
  payout_ratio?: number | null;
  retention_ratio?: number | null;
  buyback_ratio?: number | null;
  total_payout_ratio?: number | null;
  sustainable_growth?: number | null;
};

function pctNum(v: unknown): number | null {
  const n = Number(v);
  return v !== null && v !== undefined && Number.isFinite(n)
    ? Number((n * 100).toFixed(1))
    : null;
}

export async function GET(req: NextRequest) {
  const cors = openbbCors(req);
  const sp = req.nextUrl.searchParams;
  const ticker = (sp.get("ticker") || "AAPL").trim().toUpperCase();
  const periods = (sp.get("periods") || "16").trim();
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
  const rows = (d.rows ?? []).map((r) => ({
    date: r.period_end_date ?? "—",
    Payout: pctNum(r.payout_ratio),
    Retention: pctNum(r.retention_ratio),
    Buyback: pctNum(r.buyback_ratio),
    "Total payout": pctNum(r.total_payout_ratio),
    "Sustainable growth": pctNum(r.sustainable_growth),
  }));

  return NextResponse.json(rows, { headers: cors });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: openbbCors(req),
  });
}
