import type { McpLikeServer } from "@/lib/mcp/tools/riskmodels-tools";

// Bump the URI when the widget contract changes: hosts cache UI resources by URI.
export const CHART_WIDGET_URI = "ui://riskmodels/chart-v1.html";

/** Displays the original tool image. No chart reconstruction, fetches or storage. */
export const CHART_WIDGET_HTML = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RiskModels chart</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:12px;background:#fff;color:#092e59;font:14px/1.5 system-ui,sans-serif}
figure{margin:0}img{display:block;width:100%;height:auto}img[hidden]{display:none}
figcaption{padding:10px 4px 2px;color:#475569;overflow-wrap:anywhere}
#status{margin:4px;color:#475569}#status[hidden]{display:none}
@media print{body{padding:0}figcaption{color:#111}}
</style></head><body>
<p id="status" role="status">Waiting for the original RiskModels chart…</p>
<figure><img id="chart" hidden alt="Original RiskModels chart"><figcaption id="provenance"></figcaption></figure>
<script>
(() => {
  const chart = document.getElementById('chart');
  const caption = document.getElementById('provenance');
  const status = document.getElementById('status');
  let initialized = false;
  let hasStandardResult = false;
  let lastSize = '';
  const send = (message) => window.parent.postMessage({jsonrpc:'2.0', ...message}, '*');
  function resize() {
    if (!initialized) return;
    const size = {width:document.documentElement.clientWidth, height:Math.ceil(document.body.getBoundingClientRect().height)};
    const key = JSON.stringify(size);
    if (key !== lastSize) { lastSize = key; send({method:'ui/notifications/size-changed', params:size}); }
  }
  function clear(message) {
    chart.hidden = true;
    chart.removeAttribute('src');
    caption.textContent = '';
    status.textContent = message;
    status.hidden = false;
    resize();
  }
  function render(result) {
    clear('This result has no displayable PNG. Request format png to view the original chart.');
    if (!result || !Array.isArray(result.content)) return;
    let metadata = {};
    for (const block of result.content) {
      if (block.type === 'text') {
        try { const value = JSON.parse(block.text); if (value && typeof value === 'object') { metadata = value; break; } } catch {}
      }
    }
    if (result.isError || metadata.error) { clear('The chart could not be loaded. See the tool response for details.'); return; }
    const image = result.content.find(block => block.type === 'image' && block.mimeType === 'image/png');
    if (!image || typeof image.data !== 'string' || !/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(image.data)) return;
    const date = typeof metadata.resolved_as_of === 'string' ? metadata.resolved_as_of : 'unavailable';
    const receipt = typeof metadata.receipt_id === 'string' ? metadata.receipt_id : 'unavailable';
    chart.alt = 'Original RiskModels chart. Data date: ' + date + '. Receipt: ' + receipt + '.';
    caption.textContent = 'Data date: ' + date + ' · Receipt: ' + receipt + ' · Original RiskModels image';
    chart.src = 'data:image/png;base64,' + image.data;
    chart.hidden = false;
    status.hidden = true;
    resize();
  }
  chart.addEventListener('load', resize);
  chart.addEventListener('error', () => clear('The supplied image could not be displayed.'));
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.jsonrpc !== '2.0') return;
    const message = event.data;
    if (message.id === 'rmgraph-init' && message.result && !initialized) {
      initialized = true;
      send({method:'ui/notifications/initialized', params:{}});
      resize();
    } else if (message.method === 'ui/notifications/tool-result') {
      hasStandardResult = true;
      render(message.params);
    } else if (message.method === 'ui/notifications/tool-input') {
      clear('Loading the original RiskModels chart…');
    } else if (message.method === 'ui/notifications/tool-cancelled') {
      clear('Chart request cancelled.');
    } else if (message.method === 'ping' && message.id != null) {
      send({id:message.id, result:{}});
    } else if (message.method === 'ui/resource-teardown' && message.id != null) {
      observer?.disconnect();
      clear('Chart closed.');
      send({id:message.id, result:{}});
    }
  });
  // ChatGPT's compatibility bridge preserves the complete MCP result envelope.
  function compatibilityResult(globals) {
    if (hasStandardResult) return;
    const metadata = globals?.toolResponseMetadata;
    const result = metadata?.mcp_tool_result ?? metadata?.call_tool_result;
    if (result) render(result);
  }
  window.addEventListener('openai:set_globals', event => compatibilityResult(event.detail?.globals));
  compatibilityResult(window.openai);
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(document.body);
  send({id:'rmgraph-init', method:'ui/initialize', params:{
    appInfo:{name:'RiskModels chart',version:'1.0.0'},
    appCapabilities:{availableDisplayModes:['inline']}, protocolVersion:'2026-01-26'
  }});
})();
</script></body></html>`;

export function registerChartWidget(server: McpLikeServer): void {
  server.registerResource("riskmodels-chart", CHART_WIDGET_URI,
    { title: "Original RiskModels chart", mimeType: "text/html;profile=mcp-app" },
    async () => ({ contents: [{
      uri: CHART_WIDGET_URI,
      mimeType: "text/html;profile=mcp-app",
      text: CHART_WIDGET_HTML,
      _meta: {
        ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
        "openai/widgetDescription": "Displays the original RiskModels PNG with its data date and receipt. No chart is redrawn.",
        "openai/widgetPrefersBorder": true,
        "openai/widgetCSP": { connect_domains: [], resource_domains: [] },
      },
    }] }),
  );
}
