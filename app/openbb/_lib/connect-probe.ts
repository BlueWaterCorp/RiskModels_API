/**
 * Schema-valid responses for OpenBB Workspace "Test connection" probes.
 *
 * OpenBB's connect-test often hits widget endpoints without forwarding the user's
 * X-API-KEY (and without query params). Returning 401/400 there makes their
 * validator throw a generic 500. These probes are explicit "wire your key"
 * placeholders — not market data (no-mock-data rule).
 */

export type MetricsRow = { metric: string; value: string };

/** Minimal 1-page blank PDF (valid structure, ~400 bytes decoded). */
export const MINIMAL_PDF_BASE64 =
  "JVBERi0xLjcKJeLjz9MKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFszIDAgUl0KL0NvdW50IDEKPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL01lZGlhQm94IFswIDAgNjEyIDc5Ml0KPj4KZW5kb2JqCnhyZWYKMCA0CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNSAwMDAwMCBuIAowMDAwMDAwMDY0IDAwMDAwIG4gCjAwMDAwMDAxMjEgMDAwMDAgbiAKdHJhaWxlcgo8PAovU2l6ZSA0Ci9Sb290IDEgMCBSCj4+CnN0YXJ0eHJlZgoyMDMKJSVFT0Y=";

export function metricsConnectProbe(): MetricsRow[] {
  return [
    {
      metric: "Status",
      value: "Add X-API-KEY (rm_agent_live_*) in OpenBB Connections to load data",
    },
  ];
}

export function snapshotConnectProbe(ticker: string) {
  return {
    data_format: {
      data_type: "pdf" as const,
      filename: `${ticker}_connect_probe.pdf`,
    },
    content: MINIMAL_PDF_BASE64,
  };
}
