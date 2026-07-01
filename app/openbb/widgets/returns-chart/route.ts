/**
 * Live widget: cumulative total return → OpenBB line chart (table-backed).
 *
 * GET /openbb/widgets/returns-chart?ticker=AAPL&years=1
 * Maps the real /ticker-returns daily series into an index-to-100 total-return
 * curve (compounding `returns_gross`). Returns plain rows; widgets.json renders
 * them as a line via the built-in chartView (degrades to a table).
 */
import { NextRequest, NextResponse } from "next/server";
import { noKeyRows } from "../../_lib/connect-probe";
import { openbbCors } from "../../_lib/cors";
import { bearerFromRequest, upstreamGet } from "../../_lib/upstream";

export const dynamic = "force-dynamic";

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
    (body as { data?: Array<{ date: string; returns_gross: number | null }> }).data ?? [];

  // Index to 100 at the first observation, then compound daily total returns.
  let idx = 100;
  const rows = data.map((r, i) => {
    if (i > 0 && typeof r.returns_gross === "number" && Number.isFinite(r.returns_gross)) {
      idx *= 1 + r.returns_gross;
    }
    return { date: r.date, indexed_return: Number(idx.toFixed(2)) };
  });

  return NextResponse.json(rows, { headers: cors });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: openbbCors(req) });
}
