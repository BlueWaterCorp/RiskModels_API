/**
 * Live widget: portfolio risk + L1/L2/L3 hedge layering → OpenBB table.
 *
 * GET /openbb/widgets/portfolio?positions=AAPL:0.4,MSFT:0.35,NVDA:0.25
 * Parses the positions string, POSTs to /portfolio/risk-snapshot, and maps the
 * portfolio-level L3 decomposition + the hedge-layering ladder (L1 SPY-only →
 * L2 +sector → L3 +subsector, with residual left at each layer). Nulls → "—".
 */
import { NextRequest, NextResponse } from "next/server";
import { noKeyRows } from "../../_lib/connect-probe";
import { openbbCors } from "../../_lib/cors";
import { bearerFromRequest } from "../../_lib/upstream";
import { parsePositions, fetchPortfolioSnapshot } from "../../_lib/portfolio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Row = { metric: string; value: string };
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

  const d = body as {
    as_of?: string;
    portfolio_risk_index?: {
      variance_decomposition?: Record<string, unknown>;
      portfolio_volatility_23d?: number | null;
      position_count?: number | null;
    };
    portfolio_hedge_levels?: Record<string, Record<string, unknown>>;
    summary?: { resolved?: number };
  };
  const pri = d.portfolio_risk_index ?? {};
  const vd = pri.variance_decomposition ?? {};
  const hl = d.portfolio_hedge_levels ?? {};
  const L = (lvl: string) => hl[lvl] ?? {};

  const rows: Row[] = [
    { metric: "Positions", value: String(pri.position_count ?? d.summary?.resolved ?? positions.length) },
    { metric: "As of", value: d.as_of ?? "—" },
    { metric: "L3 explained risk — Market (%)", value: pct(vd.market) },
    { metric: "L3 explained risk — Sector (%)", value: pct(vd.sector) },
    { metric: "L3 explained risk — Subsector (%)", value: pct(vd.subsector) },
    { metric: "L3 explained risk — Residual (%)", value: pct(vd.residual) },
    { metric: "Systematic — mkt+sec+sub (%)", value: pct(vd.systematic) },
    { metric: "Portfolio volatility — 23d annualised (%)", value: pct(pri.portfolio_volatility_23d) },
    // Hedge layering ladder — each layer adds a leg and shrinks the residual.
    { metric: "L1 hedge (SPY) — Market HR", value: num(L("L1").market_hr) },
    { metric: "L1 — residual left (%)", value: pct(L("L1").residual_er) },
    { metric: "L2 hedge (+ sector) — Market HR", value: num(L("L2").market_hr) },
    { metric: "L2 — Sector HR", value: num(L("L2").sector_hr) },
    { metric: "L2 — residual left (%)", value: pct(L("L2").residual_er) },
    { metric: "L3 hedge (+ subsector) — Market HR", value: num(L("L3").market_hr) },
    { metric: "L3 — Sector HR", value: num(L("L3").sector_hr) },
    { metric: "L3 — Subsector HR", value: num(L("L3").subsector_hr) },
    { metric: "L3 — residual left (%)", value: pct(L("L3").residual_er) },
  ];

  return NextResponse.json(rows, { headers: cors });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: openbbCors(req) });
}
