/**
 * Live widget data endpoint: single-name risk metrics → OpenBB table rows.
 *
 * GET /openbb/widgets/metrics?ticker=AAPL
 * Auth: X-API-KEY header (the OpenBB user's rm_agent_live_* key), forwarded
 * upstream as a Bearer token. Maps the real /metrics/{ticker} response — no
 * synthetic values; missing fields render as "—".
 */
import { NextRequest, NextResponse } from "next/server";
import { metricsConnectProbe } from "../../_lib/connect-probe";
import { openbbCors } from "../../_lib/cors";
import { bearerFromRequest, upstreamGet } from "../../_lib/upstream";

export const dynamic = "force-dynamic";

type Row = { metric: string; value: string };

function num(v: unknown, digits = 3): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
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
  const cors = openbbCors(req.headers.get("origin"));
  // OpenBB widget validation probes endpoints without query params; default to
  // the same ticker declared in widgets.json params[].value.
  const ticker = (req.nextUrl.searchParams.get("ticker") || "AAPL")
    .trim()
    .toUpperCase();

  const key = bearerFromRequest(req);
  if (!key) {
    // OpenBB connect-test probes widget routes without forwarding auth; 401 → their 500.
    return NextResponse.json(metricsConnectProbe(), { headers: cors });
  }

  const { status, body } = await upstreamGet(
    `/metrics/${encodeURIComponent(ticker)}`,
    key,
  );

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
    meta?: Record<string, unknown>;
    _data_health?: { data_as_of?: string };
  };
  const m = d.metrics ?? {};

  const rows: Row[] = [
    { metric: "Ticker", value: d.ticker ?? ticker },
    { metric: "As of", value: d._data_health?.data_as_of ?? d.teo ?? "—" },
    { metric: "Price (close)", value: money(m.price_close) },
    { metric: "Market cap", value: money(m.market_cap) },
    { metric: "Volatility — 252d (annualised)", value: num(m.vol_252d_ann) },
    { metric: "Volatility — 23d", value: num(m.vol_23d) },
    { metric: "Market beta (L1)", value: num(m.l1_mkt_beta) },
    { metric: "Sector beta (L2)", value: num(m.l2_sec_beta) },
    { metric: "Subsector beta (L3)", value: num(m.l3_sub_beta) },
    { metric: "Market hedge ratio (L3)", value: num(m.l3_mkt_hr) },
    { metric: "Sector hedge ratio (L3)", value: num(m.l3_sec_hr) },
    { metric: "Subsector hedge ratio (L3)", value: num(m.l3_sub_hr) },
    { metric: "Lstar residual level", value: String(m.lstar_level ?? "—") },
    { metric: "Recommended hedge level", value: String(m.recommended_hedge_level ?? "—") },
    { metric: "Sector ETF", value: String(d.meta?.sector_etf ?? "—") },
    { metric: "Subsector ETF", value: String(d.meta?.subsector_etf ?? "—") },
  ];

  return NextResponse.json(rows, { headers: cors });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: openbbCors(req.headers.get("origin")),
  });
}
