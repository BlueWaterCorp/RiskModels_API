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
    /** top_holdings_erm_stacked / holdings_active_panel: rows to render (1–50, default 12 / 10). */
    top_n?: number;
    /** cumulative_return_strip: trailing window (default "max"). */
    window?: "3m" | "6m" | "1y" | "2y" | "max";
    /**
     * holdings_active_panel (G.45): bw_bench_id | alias | ff_own |
     * cell_<slug>. Default ff_own. Development-status benches are refused
     * upstream with 409 (readiness registry) — surface that refusal.
     */
    benchmark?: string;
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

/**
 * Subject kinds render-svc resolves from a `subject_id` prefix.
 * Mirrors `_SUBJECT_PREFIX_KIND` in `services/render-svc/render_svc/artifacts.py`.
 */
export const ARTIFACT_SUBJECT_KINDS = [
  "fund",
  "etf",
  "filer_13f",
  "cohort",
  "stock",
  "client_portfolio",
] as const;

export type ArtifactSubjectKind = (typeof ARTIFACT_SUBJECT_KINDS)[number];

/**
 * Subject kinds render-svc cannot render live — it only reads a pre-rendered
 * artifact out of GCS. Mirrors `_PRERENDERED_SUBJECT_KINDS` in artifacts.py.
 *
 * These reject `as_of="latest"` outright: render-svc has no SDK loader for
 * them, so it cannot resolve what "latest" means. A caller must pass an ISO
 * date matching an artifact that already exists, and gets a 501 naming the
 * exact GCS path on a miss. This is a property of the *subject kind*, not of
 * any one slug — the previous note here recorded it against
 * `cumulative_return_strip` alone, which read as a slug-specific caveat and
 * hid it from every other filer slug.
 */
export const PRERENDERED_SUBJECT_KINDS: readonly ArtifactSubjectKind[] = [
  "filer_13f",
  "cohort",
];

/**
 * What one (slug, subject_kind) pair can actually do.
 *
 * Capability is a property of the **pair**, never of a slug alone. The same
 * renderer can be sound for one subject kind and return an empty chart for
 * another — `top_holdings_erm_stacked` does exactly that — so a per-slug list
 * of "supported kinds" has nowhere to put that fact and ends up asserting a
 * capability that does not hold.
 *
 * - `verified` — returned drawable data for a real subject, checked against
 *   prod. The only status that may be advertised.
 * - `degraded` — returns HTTP 200 with structurally valid but empty content.
 *   Worse than an error, because nothing alerts. Must never be advertised.
 * - `unavailable` — no adapter, or no pre-rendered content. Recorded rather
 *   than deleted so the next audit does not re-add it hopefully.
 */
export type ArtifactCapability = {
  status: "verified" | "degraded" | "unavailable";
  /** Required for anything not `verified`: what happens and why. */
  reason?: string;
  notes?: string;
  /**
   * Which filer id convention this pair's artifacts are stored under.
   *
   * Documentation only — render-svc resolves both spellings (`filer_ids.py`),
   * so a caller does not need to pick. Recorded because "which form is on
   * disk" is a real fact about the bucket that nothing else writes down.
   */
  filerIdForm?: "bare" | "cik";
};

/**
 * The audited capability table — SSOT for what render-svc can do.
 *
 * Every entry was checked end-to-end against prod render-svc on 2026-08-01
 * (19 slug prefixes in the artifact bucket, 48 (slug, subject) probes). Status
 * records the observed result, not what an adapter signature implies.
 *
 * Three `narrative_*` slugs were removed in that pass — render-svc answers
 * `No fund adapter wired` for all three and no GCS prefix has ever existed for
 * them. They are kept below as `unavailable` rather than silently dropped.
 */
export const ARTIFACT_RENDER_CAPABILITY: Record<
  string,
  Partial<Record<ArtifactSubjectKind, ArtifactCapability>>
> = {
  top_holdings_erm_stacked: {
    filer_13f: { status: "verified", filerIdForm: "bare" },
    fund: {
      status: "verified",
      notes:
        "Was degraded until 2026-08-01 — rendered raw bw_sym_id labels (BW-BBG…) with " +
        "every risk share null, because prod render-svc had no Supabase credentials and " +
        "enrich_fund_data_with_supabase soft-fails to [] without them. Fixed by wiring " +
        "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from Doppler erm3/prd; re-verified " +
        "against prod (NVDA/AAPL/MSFT with real market/sector/residual shares).",
    },
    client_portfolio: {
      status: "verified",
      notes:
        "Pass-through: holdings_from_client_portfolio reads l3_mkt_er / l3_sec_er / " +
        "l3_sub_er / l3_res_er off the supplied positions and looks nothing up. A payload " +
        "carrying only ticker+weight therefore renders null segments — that is the contract " +
        "working, not a defect. Always requires subject_payload.positions; the id alone is " +
        "never sufficient, even for a previously rendered portfolio.",
    },
  },
  cumulative_return_strip: {
    fund: { status: "verified" },
    filer_13f: {
      status: "unavailable",
      reason:
        "Slug exists in GCS but holds only BW-FUND-* subjects, so every filer call 501s. " +
        "Was declared filer-capable before the 2026-08-01 audit.",
    },
  },
  entity_header: { filer_13f: { status: "verified", filerIdForm: "bare" } },
  return_composition_bars: { filer_13f: { status: "verified", filerIdForm: "bare" } },
  risk_summary_panel: { filer_13f: { status: "verified", filerIdForm: "bare" } },
  nav_composition_dual: {
    filer_13f: {
      status: "verified",
      filerIdForm: "cik",
      notes: "5 filer subjects — the widest filer coverage of any slug.",
    },
  },
  active_risk_composition: {
    filer_13f: {
      status: "unavailable",
      reason: "No GCS prefix exists; render-svc 501s. Declared before the audit.",
    },
  },
  // Cohort research artifacts (BW-COHORT-RES-*), published by the BWMACRO
  // papers pipeline. Pre-rendered only — all verified against prod 2026-08-01.
  cumulative_panels: { cohort: { status: "verified" } },
  lag_erosion: { cohort: { status: "verified" } },
  macro_correlation_arrows: { cohort: { status: "verified" } },
  risk_dna_stacked: { cohort: { status: "verified" } },
  rolling_residual_share: { cohort: { status: "verified" } },
  turnover_bars: { cohort: { status: "verified" } },
  variance_shares_bars: { cohort: { status: "verified" } },
  waterfall_pair_compare: { cohort: { status: "verified" } },
  // O.6 stock panels (2026-07-14) — live decompose loader on render-svc.
  // Slow: 13–17s each against prod, no pre-render. See G.32.
  l3_explained_risk_hbar: { stock: { status: "verified" } },
  hedge_notionals_hbar: { stock: { status: "verified" } },
  hedge_depth_retained: { stock: { status: "verified" } },
  watchlist_er_stacked: {
    stock: {
      status: "verified",
      notes:
        "Requires subject_payload.tickers; subject_id BW-STOCK-WATCHLIST. " +
        "A second mode — peer group (G.43): subject_id BW-STOCK-{TICKER} with no " +
        "payload renders the target vs its top-6 market-cap peers from /api/peers, " +
        "with broadening warnings and an explicit empty state — is in render-svc " +
        "code but NOT yet deployed (render-svc does not deploy on merge). Re-audit " +
        "and extend this note after the next render-svc deploy; until then only the " +
        "payload.tickers form is live.",
    },
  },
  position_cumulative_decomposition: {
    stock: {
      status: "unavailable",
      reason:
        "Has pre-rendered content in GCS but no stock adapter — render-svc answers " +
        "`No stock adapter wired`. Listed so a future audit does not mistake the GCS " +
        "objects for a working capability.",
    },
  },
  narrative_profile: {
    fund: { status: "unavailable", reason: "No fund adapter; never rendered." },
  },
  narrative_perf_insight: {
    fund: { status: "unavailable", reason: "No fund adapter; never rendered." },
  },
  narrative_risk_insight: {
    fund: { status: "unavailable", reason: "No fund adapter; never rendered." },
  },
  holdings_active_panel: {
    fund: {
      status: "verified",
      reason:
        "G.45: loader over GET /api/data/benchmark-fit, renderer in the SDK at " +
        "riskmodels.snapshots.artifacts.holdings_active_panel.v1, params benchmark + " +
        "top_n, default benchmark ff_own. Verified against prod render-svc " +
        "(revision render-svc-00033-vv6, 2026-08-02): BW-FUND-S000000008 ff_own " +
        "returned active_share 0.227, matching the pre-merge measurement. Static " +
        "BW-BENCH benches stay 409-gated by the readiness registry until the " +
        "Funds_DAG writer fix lands (H.145) — verified the gate still refuses " +
        "benchmark=spy with 409 on the same revision.",
    },
  },
};

/**
 * Flat per-slug view, **derived** from the capability table.
 *
 * Kept because callers embed it in error payloads to tell a model what it may
 * ask for. Derived rather than hand-maintained so a `degraded` pair cannot be
 * advertised: the only way to add a kind here is to verify it. That property is
 * the point — the previous hand-written version listed `fund` and
 * `client_portfolio` for `top_holdings_erm_stacked`, both of which render empty.
 */
export const WIRED_ARTIFACT_RENDER_MATRIX: Record<
  string,
  { subject_kinds: string[]; notes?: string }
> = Object.fromEntries(
  Object.entries(ARTIFACT_RENDER_CAPABILITY)
    .map(([slug, byKind]) => {
      const verified = Object.entries(byKind)
        .filter(([, cap]) => cap?.status === "verified")
        .map(([kind]) => kind);
      const notes = Object.values(byKind)
        .filter((c) => c?.status === "verified" && c.notes)
        .map((c) => c!.notes!)
        .join(" ");
      return [slug, notes ? { subject_kinds: verified, notes } : { subject_kinds: verified }];
    })
    .filter(([, v]) => (v as { subject_kinds: string[] }).subject_kinds.length > 0),
);

/** Every (slug, kind) that returns 200 but is not drawable — never advertise these. */
export const DEGRADED_ARTIFACT_PAIRS: ReadonlyArray<{
  slug: string;
  subject_kind: ArtifactSubjectKind;
  reason: string;
}> = Object.entries(ARTIFACT_RENDER_CAPABILITY).flatMap(([slug, byKind]) =>
  Object.entries(byKind)
    .filter(([, cap]) => cap?.status === "degraded")
    .map(([kind, cap]) => ({
      slug,
      subject_kind: kind as ArtifactSubjectKind,
      reason: cap!.reason ?? "",
    })),
);

/**
 * Filer id spellings are resolved by render-svc, not here.
 *
 * Two spellings of one identity are live — `BW-FILER-<cik>` and
 * `BW-FILER-CIK<cik>` — and both are correct for some slug. That resolution
 * belongs in exactly one place, and as of Risk_Models #296 it lives in
 * `services/render-svc/render_svc/filer_ids.py`, which declares the bare form
 * canonical and probes both spellings on a store lookup. A client-side copy
 * used to live here; it was deleted rather than kept in sync, because several
 * maps for one identity is the C.13 failure and re-implementing the rule per
 * caller is how you get there.
 *
 * `filerIdForm` survives on the capability table above as documentation of
 * where each slug's objects are stored. It is a note, not a second resolver.
 */

/**
 * Add the missing half of a pre-rendered miss.
 *
 * render-svc's 501 names the GCS path it wanted, which is precise but reads as
 * "this slug is not implemented" — the same text a genuinely unwired slug
 * returns. For a pre-rendered kind the far more likely causes are an `as_of`
 * that does not exist yet or the wrong filer id convention, so say that. The
 * upstream message is preserved verbatim ahead of the hint.
 */
function appendPrerenderHint(
  message: string,
  slug: string,
  subjectId: string,
  asOf: string,
): string {
  const kind = subjectKindOf(subjectId);
  if (!kind || !PRERENDERED_SUBJECT_KINDS.includes(kind)) return message;

  const hints = [
    `subject_kind='${kind}' is pre-rendered only: render-svc reads an existing artifact and cannot build one on demand.`,
  ];
  if (asOf === "latest") {
    // render-svc's own 404 now lists the dates that do exist, and
    // GET /artifacts/as-of answers the question directly, so point at that
    // rather than repeating dates this side cannot know.
    hints.push(
      `as_of='latest' is never valid here — call GET /artifacts/as-of?slug=${slug}&subject_id=${subjectId} for the dates that exist.`,
    );
  }
  // Nothing about filer id spellings: render-svc resolves both and its 404
  // already names which spellings it tried. Repeating that here would be a
  // second, staler copy of the same explanation.
  return `${message} (${hints.join(" ")})`;
}

/**
 * Resolve a subject kind from an id prefix, mirroring `_SUBJECT_PREFIX_KIND`
 * in `services/render-svc/render_svc/artifacts.py`.
 *
 * `BW-COHORT-` always resolves to `cohort`. The `.net` contract additionally
 * declares `fund_cohort` against the *same* prefix — server-side the two are
 * one kind and the distinction is UI-level, so it is not recoverable from an
 * id and must not be guessed here (`contracts.ts::SUBJECT_ID_PREFIX` records
 * the same wrinkle from the other side).
 */
export function subjectKindOf(subjectId: string): ArtifactSubjectKind | null {
  if (subjectId.startsWith("BW-FUND-")) return "fund";
  if (subjectId.startsWith("BW-ETF-")) return "etf";
  if (subjectId.startsWith("BW-FILER-")) return "filer_13f";
  if (subjectId.startsWith("BW-COHORT-")) return "cohort";
  if (subjectId.startsWith("BW-STOCK-")) return "stock";
  if (subjectId.startsWith("BW-PORTFOLIO-")) return "client_portfolio";
  return null;
}

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
  const subject_id = params.subject_id;

  const body: Record<string, unknown> = {
    slug: params.slug,
    version,
    subject_id,
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
      error: appendPrerenderHint(errMsg, params.slug, subject_id, as_of),
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
