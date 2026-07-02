/**
 * Live widget: per-position portfolio breakdown → OpenBB table.
 *
 * GET /openbb/widgets/portfolio-positions?positions=AAPL:0.4,MSFT:0.35,NVDA:0.25
 * Same positions string as the portfolio widget; one row per name with its
 * weight, L3 explained-risk split, and L3 hedge ratios.
 */
import { NextRequest, NextResponse } from "next/server";
import { noKeyRows } from "../../_lib/connect-probe";
import { openbbCors } from "../../_lib/cors";
import { bearerFromRequest } from "../../_lib/upstream";
import { parsePositions, fetchPortfolioSnapshot } from "../../_lib/portfolio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const pct = (x: unknown): string =>
  x == null || Number.isNaN(Number(x)) ? "—" : `${(Number(x) * 100).toFixed(1)}%`;
const num = (x: unknown): string =>
  x == null || Number.isNaN(Number(x)) ? "—" : Number(x).toFixed(3);

export async function GET(req: NextRequest) {
  const cors = openbbCors(req);
  const positions = parsePositions(
    req.nextUrl.searchParams.get("positions") || "AAPL:0.4, MSFT:0.35, NVDA:0.25",
  );

  const key = bearerFromRequest(req);
  if (!key) return NextResponse.json(noKeyRows(), { headers: cors });
  if (!positions.length) {
    return NextResponse.json(
      [{ status: "Enter positions, e.g. AAPL:0.4, MSFT:0.35, NVDA:0.25" }],
      { headers: cors },
    );
  }

  const { status, body } = await fetchPortfolioSnapshot(positions, key);
  if (status < 200 || status >= 300) {
    const message =
      (body as { error?: string; message?: string })?.error ||
      (body as { message?: string })?.message ||
      `Upstream returned ${status}`;
    return NextResponse.json({ error: message }, { status, headers: cors });
  }

  const perTicker =
    (body as { per_ticker?: Record<string, Record<string, unknown>> }).per_ticker ?? {};

  const rows = Object.keys(perTicker)
    .sort()
    .map((t) => {
      const r = perTicker[t];
      return {
        ticker: t,
        weight: pct(r.weight),
        market_er: pct(r.l3_mkt_er),
        residual_er: pct(r.l3_res_er),
        mkt_hr: num(r.l3_mkt_hr),
        sec_hr: num(r.l3_sec_hr),
        sub_hr: num(r.l3_sub_hr),
      };
    });

  return NextResponse.json(rows, { headers: cors });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: openbbCors(req) });
}
