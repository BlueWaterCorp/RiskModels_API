/**
 * Server-side client for render-svc `POST /artifacts/render`.
 * SSOT: `services/render-svc/render_svc/artifacts.py`
 */

import { authorizationHeaderForCloudRun } from "@/lib/artifacts/gcp-id-token";

/**
 * ``figure`` returns a Plotly figure spec (``fig.to_json()``) for
 * Plotly-backed slugs — the live client-side form, rendered by plotly.js
 * rather than rasterized server-side. Non-Plotly slugs reject it with 400.
 */
export type ArtifactRenderFormat = "json" | "png" | "svg" | "figure";

export interface ArtifactRenderParams {
  slug: string;
  version?: string;
  subject_id: string;
  as_of?: string;
  format?: ArtifactRenderFormat;
  subject_payload?: Record<string, unknown> | null;
  /**
   * Per-slug render params (render-svc Phase 3). Forwarded verbatim as the
   * request's `params` field; render-svc validates per slug (422 on
   * unknown/inapplicable) and folds them into the render-once cache key.
   */
  params?: {
    /** top_holdings_erm_stacked: rows to render (1–50, default 12). */
    top_n?: number;
    /** cumulative_return_strip: trailing window (default "max"). */
    window?: "3m" | "6m" | "1y" | "2y" | "max";
  };
}

export interface ArtifactRenderSuccess {
  ok: true;
  data: unknown;
  resolved_as_of: string;
  gcs_path: string;
  receipt_id: string | null;
  format: ArtifactRenderFormat;
}

export interface ArtifactRenderFailure {
  ok: false;
  status: number;
  error: string;
  detail?: unknown;
}

export type ArtifactRenderResult = ArtifactRenderSuccess | ArtifactRenderFailure;

/** Slugs with render-svc adapters wired today (see artifacts.py). */
export const WIRED_ARTIFACT_RENDER_MATRIX: Record<
  string,
  { subject_kinds: string[]; notes?: string }
> = {
  top_holdings_erm_stacked: {
    subject_kinds: ["fund", "client_portfolio", "filer_13f"],
  },
  cumulative_return_strip: {
    subject_kinds: ["fund", "filer_13f"],
    notes: "filer: cache hit or explicit as_of only (no live loader on miss).",
  },
  narrative_profile: { subject_kinds: ["fund"] },
  narrative_perf_insight: { subject_kinds: ["fund"] },
  narrative_risk_insight: { subject_kinds: ["fund"] },
  entity_header: { subject_kinds: ["filer_13f"] },
  return_composition_bars: { subject_kinds: ["filer_13f"] },
  active_risk_composition: { subject_kinds: ["filer_13f"] },
  risk_summary_panel: { subject_kinds: ["filer_13f"] },
  // O.6 stock panels (2026-07-14) — live decompose loader on render-svc
  l3_explained_risk_hbar: { subject_kinds: ["stock"] },
  hedge_notionals_hbar: { subject_kinds: ["stock"] },
  hedge_depth_retained: { subject_kinds: ["stock"] },
  watchlist_er_stacked: {
    subject_kinds: ["stock"],
    notes: "Requires subject_payload.tickers; subject_id BW-STOCK-WATCHLIST.",
  },
};

function renderSvcUrl(): string | null {
  const raw = process.env.RENDER_SVC_URL?.trim();
  return raw ? raw.replace(/\/$/, "") : null;
}

function parseJsonBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw_text: text.slice(0, 500) };
  }
}

/**
 * Render a registry artifact via render-svc. JSON responses are parsed;
 * binary formats return base64 in the result object for tool payloads.
 */
export async function renderArtifact(
  params: ArtifactRenderParams,
): Promise<ArtifactRenderResult> {
  const base = renderSvcUrl();
  if (!base) {
    return {
      ok: false,
      status: 503,
      error:
        "RENDER_SVC_URL is not configured. Artifact registry renders require the render-svc Cloud Run service (see services/render-svc/RUNBOOK.md).",
    };
  }

  const version = params.version ?? "v1";
  const as_of = params.as_of ?? "latest";
  const format = params.format ?? "json";

  const body: Record<string, unknown> = {
    slug: params.slug,
    version,
    subject_id: params.subject_id,
    as_of,
    format,
  };
  if (params.subject_payload != null) {
    body.subject_payload = params.subject_payload;
  }
  if (params.params != null) {
    body.params = params.params;
  }

  const upstream = `${base}/artifacts/render`;
  let authz: string | undefined;
  try {
    authz = await authorizationHeaderForCloudRun(base);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      status: 502,
      error: `Failed to mint Cloud Run ID token: ${msg}`,
    };
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authz) {
    headers.Authorization = authz;
  }

  let res: Response;
  try {
    res = await fetch(upstream, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      status: 502,
      error: `render-svc unreachable: ${msg}`,
    };
  }

  const resolvedAsOf = res.headers.get("x-artifact-resolved-as-of") ?? as_of;
  const gcsPath = res.headers.get("x-artifact-gcs-path") ?? "";
  const receiptId = res.headers.get("x-artifact-receipt-id");

  if (!res.ok) {
    const text = await res.text();
    let detail: unknown = text;
    try {
      detail = JSON.parse(text) as unknown;
    } catch {
      // keep text
    }
    const errMsg =
      detail &&
      typeof detail === "object" &&
      detail !== null &&
      "detail" in detail &&
      typeof (detail as { detail: unknown }).detail === "string"
        ? (detail as { detail: string }).detail
        : `render-svc returned HTTP ${res.status}`;
    return {
      ok: false,
      status: res.status,
      error: errMsg,
      detail,
    };
  }

  // Figure specs are JSON too — parse rather than base64-wrapping them, so a
  // caller gets a usable spec object instead of an opaque blob.
  if (format === "json" || format === "figure") {
    const text = await res.text();
    return {
      ok: true,
      data: parseJsonBody(text),
      resolved_as_of: resolvedAsOf,
      gcs_path: gcsPath,
      receipt_id: receiptId,
      format,
    };
  }

  const buf = await res.arrayBuffer();
  const bytes = Buffer.from(buf);
  return {
    ok: true,
    data: {
      format,
      content_type: res.headers.get("content-type") ?? `image/${format}`,
      base64: bytes.toString("base64"),
      byte_length: bytes.length,
    },
    resolved_as_of: resolvedAsOf,
    gcs_path: gcsPath,
    receipt_id: receiptId,
    format,
  };
}
