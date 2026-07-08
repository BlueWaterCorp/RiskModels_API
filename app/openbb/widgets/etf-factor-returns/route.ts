/**
 * Live widget: factor-ETF trailing returns → OpenBB bar chart (table-backed).
 *
 * GET /openbb/widgets/etf-factor-returns?sleeve=all
 * Maps the real /etf/factor-returns one-teo snapshot (SPY + 11 GICS sector
 * SPDRs, trailing 1d/21d/63d/252d total returns) into percent rows, one per
 * ETF. Returns plain rows; widgets.json renders them as a grouped bar via the
 * built-in chartView (degrades to a readable table).
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
  const sleeve = (req.nextUrl.searchParams.get("sleeve") || "all").trim();

  const key = bearerFromRequest(req);
  if (!key) return NextResponse.json(noKeyRows(), { headers: cors });

  const { status, body } = await upstreamGet(
    `/etf/factor-returns?sleeve=${encodeURIComponent(sleeve)}`,
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
      rows?: Array<{
        ticker: string;
        name: string;
        sleeve: string;
        returns: Record<string, number | null>;
      }>;
    }).rows ?? [];

  const rows = data.map((r) => ({
    ticker: r.ticker,
    name: r.name,
    sleeve: r.sleeve,
    return_1d: pct(r.returns?.["1d"]),
    return_21d: pct(r.returns?.["21d"]),
    return_63d: pct(r.returns?.["63d"]),
    return_252d: pct(r.returns?.["252d"]),
  }));

  return NextResponse.json(rows, { headers: cors });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: openbbCors(req) });
}
