/**
 * Live widget: institutional risk-snapshot tearsheet -> OpenBB `html` widget.
 *
 * multi_file_viewer caches by file id and does not refetch when the grouped
 * ticker changes, so AAPL stayed on screen after IBM. An HTML widget is a
 * normal data widget: GET ?ticker= follows the group like the tables.
 *
 * GET /openbb/widgets/tearsheet?ticker=IBM
 * Fetches /metrics/{ticker}/snapshot.pdf and embeds it.
 */
import { NextRequest, NextResponse } from "next/server";
import { openbbCors } from "../../_lib/cors";
import { bearerFromRequest, upstreamGetBytes } from "../../_lib/upstream";
import { readWidgetInput, WIDGET_NO_STORE } from "../../_lib/widget-request";

export const dynamic = "force-dynamic";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlPage(title: string, inner: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title><style>html,body{margin:0;height:100%;background:#111}object,embed{width:100%;height:100%;border:0}p{color:#eee;font-family:Inter,Helvetica,sans-serif;padding:24px}</style></head><body>${inner}</body></html>`;
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

  const key = bearerFromRequest(req);
  if (!key) {
    return htmlResponse(
      cors,
      htmlPage(
        "Risk Snapshot",
        "<p>Add X-API-KEY (rm_agent_live_*) in OpenBB Connections to load data</p>",
      ),
    );
  }

  const { status, bytes, error } = await upstreamGetBytes(
    `/metrics/${encodeURIComponent(ticker)}/snapshot.pdf`,
    key,
  );

  if (!bytes) {
    const message =
      (error as { error?: string; message?: string })?.error ||
      (error as { message?: string })?.message ||
      `Upstream returned ${status}`;
    return htmlResponse(
      cors,
      htmlPage(ticker, `<p>${escapeHtml(message)}</p>`),
      status >= 400 ? status : 502,
    );
  }

  const content = Buffer.from(bytes).toString("base64");
  const src = `data:application/pdf;base64,${content}`;
  return htmlResponse(
    cors,
    htmlPage(
      `${ticker} Risk Snapshot`,
      `<object data="${src}" type="application/pdf" aria-label="${escapeHtml(ticker)} risk snapshot"><embed src="${src}" type="application/pdf"/></object>`,
    ),
  );
}

export const GET = handle;
export const POST = handle;

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: openbbCors(req) });
}
