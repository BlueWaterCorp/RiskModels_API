/**
 * Live widget: single-name risk snapshot → OpenBB table (raw data).
 *
 * GET /openbb/widgets/snapshot-table?ticker=AAPL
 * The data-first replacement for the PDF snapshot widget (OpenBB's pdf.js
 * viewer wouldn't render our tearsheet). One call to /metrics/{ticker} carries
 * the whole story: L3 explained-risk decomposition, systematic share,
 * volatility, hedge level, and L3 hedge ratios. Missing fields render as "—".
 */
import { NextRequest, NextResponse } from "next/server";
import { noKeyRows } from "../../_lib/connect-probe";
import { openbbCors } from "../../_lib/cors";
import { bearerFromRequest, upstreamGet } from "../../_lib/upstream";

export const dynamic = "force-dynamic";

type Row = { metric: string; value: string };

function num(v: unknown, digits = 3): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}
function pct1(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "—";
}
function money(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toFixed(2)}`;
}

export async function GET(req: NextRequest) {
  const cors = openbbCors(req);
  const ticker = (req.nextUrl.searchParams.get("ticker") || "AAPL").trim().toUpperCase();

  const key = bearerFromRequest(req);
  if (!key) return NextResponse.json(noKeyRows(), { headers: cors });

  const { status, body } = await upstreamGet(`/metrics/${encodeURIComponent(ticker)}`, key);
  if (status < 200 || status >= 300) {
    const message =
      (body as { error?: string; message?: string })?.error ||
      (body as { message?: string })?.message ||
      `Upstream returned ${status}`;
    return NextResponse.json({ error: message }, { status, headers: cors });
  }

  const d = body as {
    ticker?: string;
    teo?: string;
    metrics?: Record<string, unknown>;
    _data_health?: { data_as_of?: string };
  };
  const m = d.metrics ?? {};

  // Systematic = market + sector + subsector explained risk (1 − residual).
  // Null when the name has no L3 decomposition (e.g. ETFs).
  const systematic =
    m.l3_mkt_er == null
      ? null
      : Number(m.l3_mkt_er ?? 0) + Number(m.l3_sec_er ?? 0) + Number(m.l3_sub_er ?? 0);

  // Units live in the metric label — OpenBB's grid strips trailing %/$ from
  // numeric-looking values, so "24.1%" renders as "24.1". Labelling the unit
  // keeps it unambiguous regardless.
  const rows: Row[] = [
    { metric: "Ticker", value: d.ticker ?? ticker },
    { metric: "As of", value: d._data_health?.data_as_of ?? d.teo ?? "—" },
    { metric: "Price — last close (USD)", value: money(m.price_close) },
    { metric: "L3 explained risk — Market (%)", value: pct1(m.l3_mkt_er) },
    { metric: "L3 explained risk — Sector (%)", value: pct1(m.l3_sec_er) },
    { metric: "L3 explained risk — Subsector (%)", value: pct1(m.l3_sub_er) },
    { metric: "L3 explained risk — Residual / stock-specific (%)", value: pct1(m.l3_res_er) },
    { metric: "Systematic — market+sector+subsector (%)", value: pct1(systematic) },
    { metric: "Volatility — 252d annualised (%)", value: pct1(m.vol_252d_ann) },
    { metric: "Recommended hedge level", value: String(m.recommended_hedge_level ?? "—") },
    { metric: "Lstar residual level", value: String(m.lstar_level ?? "—") },
    { metric: "L3 hedge ratio — Market", value: num(m.l3_mkt_hr) },
    { metric: "L3 hedge ratio — Sector", value: num(m.l3_sec_hr) },
    { metric: "L3 hedge ratio — Subsector", value: num(m.l3_sub_hr) },
  ];

  return NextResponse.json(rows, { headers: cors });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: openbbCors(req) });
}
