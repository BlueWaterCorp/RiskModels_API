import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { ReadResourceResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { CHART_WIDGET_HTML, CHART_WIDGET_URI, registerChartWidget } from "@/lib/mcp/chart-widget";
import type { McpLikeServer } from "@/lib/mcp/tools/riskmodels-tools";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOncAAAAASUVORK5CYII=";
const result = { content: [
  { type: "text", text: JSON.stringify({ resolved_as_of: "2026-09-11", receipt_id: "ead2de92" }) },
  { type: "image", mimeType: "image/png", data: png },
] };

// Run the actual shipped script against a bounded host/DOM seam, with no renderer.
function host(openai?: unknown) {
  const listeners: Record<string, (event: any) => void> = {};
  const sent: any[] = [];
  const elements = Object.fromEntries(["chart", "provenance", "status"].map(id => [id, {
    hidden: false, textContent: "", src: "", alt: "",
    addEventListener: () => {}, removeAttribute(name: string) { if (name === "src") this.src = ""; },
  }]));
  const parent = { postMessage: (message: unknown) => sent.push(message) };
  const window = { parent, openai, addEventListener: (name: string, fn: (e: any) => void) => { listeners[name] = fn; } };
  runInNewContext(CHART_WIDGET_HTML.match(/<script>([\s\S]*?)<\/script>/)![1], {
    window, document: {
      getElementById: (id: string) => elements[id],
      documentElement: { clientWidth: 600 }, body: { getBoundingClientRect: () => ({ height: 460 }) },
    },
  });
  return { elements, sent, notify: (data: unknown, source: unknown = parent) => listeners.message({ data, source }),
    compatibility: (globals: unknown) => listeners["openai:set_globals"]({ detail: { globals } }) };
}

describe("original-chart MCP Apps component", () => {
  it("registers a valid self-contained UI resource without external network access", async () => {
    let read!: Parameters<McpLikeServer["registerResource"]>[3];
    registerChartWidget({ registerResource: (_name, uri, _config, callback) => {
      expect(uri).toBe(CHART_WIDGET_URI); read = callback;
    } } as McpLikeServer);
    const resource = await read(new URL(CHART_WIDGET_URI));
    expect(ReadResourceResultSchema.safeParse(resource).success).toBe(true);
    expect(resource.contents[0]).toMatchObject({ mimeType: "text/html;profile=mcp-app", text: CHART_WIDGET_HTML,
      _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } } });
  });

  it("initializes, displays exact supplied PNG bytes and provenance, and reports size", () => {
    const h = host();
    expect(h.sent[0]).toMatchObject({ method: "ui/initialize", params: { appInfo: { name: "RiskModels chart" }, protocolVersion: "2026-01-26" } });
    h.notify({ jsonrpc: "2.0", id: "rmgraph-init", result: {} });
    expect(h.sent[1].method).toBe("ui/notifications/initialized");
    h.notify({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: result });
    expect(h.elements.chart.src).toBe("data:image/png;base64," + png);
    expect(h.elements.chart.hidden).toBe(false);
    expect(h.elements.provenance.textContent).toContain("2026-09-11 · Receipt: ead2de92");
    expect(h.sent.some(m => m.method === "ui/notifications/size-changed")).toBe(true);
  });

  it("ignores non-parent messages and clears stale charts on error, cancellation or non-image results", () => {
    const h = host();
    const message = { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: result };
    h.notify(message, {}); expect(h.elements.chart.src).toBe("");
    for (const next of [
      { ...message, params: { ...result, isError: true } },
      { ...message, params: { content: [{ type: "text", text: "{}" }] } },
      { jsonrpc: "2.0", method: "ui/notifications/tool-cancelled" },
    ]) {
      h.notify(message); h.notify(next);
      expect(h.elements.chart.src).toBe(""); expect(h.elements.chart.hidden).toBe(true);
      expect(h.elements.provenance.textContent).toBe("");
    }
  });

  it("supports ChatGPT's full-envelope compatibility bridge without overwriting a standard result", () => {
    const h = host({ toolResponseMetadata: { mcp_tool_result: result } });
    expect(h.elements.chart.src).toBe("data:image/png;base64," + png);
    h.notify({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { isError: true, content: [] } });
    h.compatibility({ toolResponseMetadata: { call_tool_result: result } });
    expect(h.elements.chart.src).toBe("");
  });

  it.each(["https://untrusted.example/chart.png", "<svg onload=alert(1)>", "iVBORw0KGgo!"])("rejects non-PNG data %s", data => {
    const h = host();
    h.notify({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { content: [{ type: "image", mimeType: "image/png", data }] } });
    expect(h.elements.chart.src).toBe("");
  });
});
