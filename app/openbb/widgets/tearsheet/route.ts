/**
 * Live widget: single-name risk snapshot → OpenBB `html` widget.
 *
 * PDF `<object>`/`<embed>` data URIs do not paint in Workspace's HTML viewer
 * (sandboxed, JS off on pro.openbb.co). This route returns the same metrics
 * the snapshot table uses, as HTML, so the grouped ticker refetches like
 * the other data widgets.
 *
 * GET /openbb/widgets/tearsheet?ticker=IBM
 * GET /openbb/widgets/tearsheet?ticker=IBM&raw=true  → JSON rows
 */
import { NextRequest, NextResponse } from "next/server";
import { openbbCors } from "../../_lib/cors";
import { bearerFromRequest, upstreamGet } from "../../_lib/upstream";
import { readWidgetInput, WIDGET_NO_STORE } from "../../_lib/widget-request";

export const dynamic = "force-dynamic";

type Row = { metric: string; value: string };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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

function snapshotRows(
  ticker: string,
  d: {
    ticker?: string;
    teo?: string;
    metrics?: Record<string, unknown>;
    _data_health?: { data_as_of?: string };
  },
): Row[] {
  const m = d.metrics ?? {};
  const systematic =
    m.l3_mkt_er == null
      ? null
      : Number(m.l3_mkt_er ?? 0) + Number(m.l3_sec_er ?? 0) + Number(m.l3_sub_er ?? 0);
  return [
    { metric: "Ticker", value: d.ticker ?? ticker },
    { metric: "As of", value: d._data_health?.data_as_of ?? d.teo ?? "—" },
    { metric: "Price — last close (USD)", value: money(m.price_close) },
    { metric: "L3 explained risk — Market", value: pct1(m.l3_mkt_er) },
    { metric: "L3 explained risk — Sector", value: pct1(m.l3_sec_er) },
    { metric: "L3 explained risk — Subsector", value: pct1(m.l3_sub_er) },
    { metric: "L3 explained risk — Residual / stock-specific", value: pct1(m.l3_res_er) },
    { metric: "Systematic — market+sector+subsector", value: pct1(systematic) },
    { metric: "Volatility — 252d annualised", value: pct1(m.vol_252d_ann) },
    { metric: "Recommended hedge level", value: String(m.recommended_hedge_level ?? "—") },
    { metric: "Lstar residual level", value: String(m.lstar_level ?? "—") },
    { metric: "L3 hedge ratio — Market ($ ETF per $1 stock)", value: num(m.l3_mkt_hr) },
    { metric: "L3 hedge ratio — Sector", value: num(m.l3_sec_hr) },
    { metric: "L3 hedge ratio — Subsector", value: num(m.l3_sub_hr) },
  ];
}

function htmlPage(title: string, inner: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title><style>
html,body{margin:0;background:#f4f1ea;color:#002a5e;font-family:Inter,Helvetica,sans-serif}
body{padding:20px 24px}
h1{font-size:22px;font-weight:650;margin:0 0 4px}
.sub{color:#5a6a7a;font-size:13px;margin-bottom:18px}
table{width:100%;border-collapse:collapse}
td{padding:9px 0;border-bottom:1px solid #d8d3d3;font-size:14px}
td.k{color:#5a6a7a}
td.v{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
p{color:#002a5e;font-size:14px}
</style></head><body>${inner}</body></html>`;
}

function htmlResponse(cors: Record<string, string>, html: string, status = 200) {
  return new NextResponse(html, {
    status,
    headers: {
      ...cors,
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

async function handle(req: NextRequest) {
  const cors = { ...openbbCors(req), ...WIDGET_NO_STORE };
  const sp = await readWidgetInput(req);
  const ticker = (sp.get("ticker") || "AAPL").trim().toUpperCase();
  const raw = ["1", "true", "yes"].includes((sp.get("raw") || "").toLowerCase());

  const key = bearerFromRequest(req);
  if (!key) {
    if (raw) {
      return NextResponse.json(
        [{ metric: "status", value: "Add X-API-KEY (rm_agent_live_*) in OpenBB Connections" }],
        { headers: cors },
      );
    }
    return htmlResponse(
      cors,
      htmlPage(
        "Risk Snapshot",
        "<p>Add X-API-KEY (rm_agent_live_*) in OpenBB Connections to load data</p>",
      ),
    );
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
    if (raw) {
      return NextResponse.json({ error: message }, { status, headers: cors });
    }
    return htmlResponse(
      cors,
      htmlPage(ticker, `<p>${escapeHtml(message)}</p>`),
      status,
    );
  }

  const d = body as {
    ticker?: string;
    teo?: string;
    metrics?: Record<string, unknown>;
    _data_health?: { data_as_of?: string };
  };
  const rows = snapshotRows(ticker, d);
  if (raw) {
    return NextResponse.json(rows, { headers: cors });
  }

  const asOf = rows.find((r) => r.metric === "As of")?.value ?? "—";
  const tr = rows
    .filter((r) => r.metric !== "Ticker" && r.metric !== "As of")
    .map(
      (r) =>
        `<tr><td class="k">${escapeHtml(r.metric)}</td><td class="v">${escapeHtml(r.value)}</td></tr>`,
    )
    .join("");
  const shown = d.ticker ?? ticker;
  return htmlResponse(
    cors,
    htmlPage(
      `${shown} Risk Snapshot`,
      `<h1>${escapeHtml(shown)}</h1><div class="sub">Risk snapshot · as of ${escapeHtml(asOf)}</div><table>${tr}</table>`,
    ),
  );
}

export const GET = handle;
export const POST = handle;

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: openbbCors(req) });
}
