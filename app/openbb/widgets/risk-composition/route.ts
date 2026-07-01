/**
 * Live widget: L3 explained-risk composition over time → OpenBB line chart.
 *
 * GET /openbb/widgets/risk-composition?ticker=AAPL&years=1
 * Maps the real /ticker-returns daily L3 explained-risk fractions
 * (l3_mkt_er / l3_sec_er / l3_sub_er / l3_res_er, which sum to 1) into percent
 * series. ETFs have no L3 decomposition → empty series (never fabricated).
 */
import { NextRequest, NextResponse } from "next/server";
import { noKeyRows } from "../../_lib/connect-probe";
import { openbbCors } from "../../_lib/cors";
import { bearerFromRequest, upstreamGet } from "../../_lib/upstream";

export const dynamic = "force-dynamic";

const pct = (x: unknown): number | null => {
  if (x === null || x === undefined) return null;
  const n = Number(x);
  return Number.isFinite(n) ? Number((n * 100).toFixed(2)) : null;
};

export async function GET(req: NextRequest) {
  const cors = openbbCors(req);
  const ticker = (req.nextUrl.searchParams.get("ticker") || "AAPL").trim().toUpperCase();
  const years = (req.nextUrl.searchParams.get("years") || "1").trim();

  const key = bearerFromRequest(req);
  if (!key) return NextResponse.json(noKeyRows(), { headers: cors });

  const { status, body } = await upstreamGet(
    `/ticker-returns?ticker=${encodeURIComponent(ticker)}&years=${encodeURIComponent(years)}`,
    key,
  );
  if (status < 200 || status >= 300) {
    const message =
      (body as { error?: string; message?: string })?.error ||
      (body as { message?: string })?.message ||
      `Upstream returned ${status}`;
    return NextResponse.json({ error: message }, { status, headers: cors });
  }

  const data =
    (body as {
      data?: Array<{
        date: string;
        l3_mkt_er?: number | null;
        l3_sec_er?: number | null;
        l3_sub_er?: number | null;
        l3_res_er?: number | null;
      }>;
    }).data ?? [];

  const rows = data.map((r) => ({
    date: r.date,
    Market: pct(r.l3_mkt_er),
    Sector: pct(r.l3_sec_er),
    Subsector: pct(r.l3_sub_er),
    Residual: pct(r.l3_res_er),
  }));

  return NextResponse.json(rows, { headers: cors });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: openbbCors(req) });
}
