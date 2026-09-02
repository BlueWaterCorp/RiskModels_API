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

/**
 * The `params.window` vocabulary render-svc's request schema accepts.
 *
 * Mirrors `ArtifactParams.window` in `artifacts.py`. Wider than any one slug:
 * the request schema admits all seven and the *artifact module* narrows further
 * (`cumulative_return_strip` accepts `max|3m|6m|1y|2y`, `historical_risk_waterfall`
 * accepts `max|1y|2y|3y|5y`). That second narrowing is deliberately NOT mirrored
 * here — see `ARTIFACT_SLUG_PARAMS`.
 */
export type ArtifactWindow = "3m" | "6m" | "1y" | "2y" | "3y" | "5y" | "max";

/**
 * Per-slug render params (render-svc Phase 3). Forwarded verbatim as the
 * request's `params` field; render-svc validates per slug (422 on
 * unknown/inapplicable) and folds them into the render-once cache key.
 *
 * All seven keys render-svc's `ArtifactParams` model declares. The previous
 * shape carried three, so `peer_n`, `sort_by`, `layers` and `date` were
 * untypeable from this side and no caller could set them.
 */
export interface ArtifactParams {
  /** top_holdings_erm_stacked / hedge_notionals_hbar / watchlist_er_stacked / holdings_active_panel: rows to render (1–50). */
  top_n?: number;
  /**
   * risk_dna_stacked: cohort truncation (1–50). Distinct from `top_n` on
   * purpose — `top_n` ranks rows inside one subject's holdings, `peer_n`
   * narrows a cohort of subjects and invalidates every cohort-level aggregate.
   */
  peer_n?: number;
  /** cumulative_return_strip / position_cumulative_decomposition / historical_risk_waterfall: trailing window. */
  window?: ArtifactWindow;
  /**
   * watchlist_er_stacked / risk_dna_stacked: row ordering. The accepted
   * vocabulary differs per slug and is validated by the artifact module, which
   * 422s through the same path an out-of-range int takes.
   */
  sort_by?: string;
  /**
   * l3_explained_risk_hbar / active_risk_composition: comma-separated cascade
   * levels ("sector,residual"). A string rather than a list so it survives a
   * query string and a GCS key fragment unchanged.
   */
  layers?: string;
  /**
   * historical_risk_waterfall: a specific observation date (YYYY-MM-DD) for a
   * history-navigating panel.
   *
   * NOT the request-level `as_of`. `as_of` selects which artifact *vintage* is
   * resolved; `date` selects which observation *inside* that vintage the panel
   * draws. A control surface needs both and must not conflate them.
   */
  date?: string;
  /**
   * holdings_active_panel (G.45): bw_bench_id | alias | ff_own |
   * cell_<slug>. Default ff_own. Development-status benches are refused
   * upstream with 409 (readiness registry) — surface that refusal.
   */
  benchmark?: string;
}

/** Every key render-svc's `ArtifactParams` model declares. */
export const ARTIFACT_PARAM_KEYS = [
  "top_n",
  "peer_n",
  "window",
  "sort_by",
  "layers",
  "date",
  "benchmark",
] as const satisfies ReadonlyArray<keyof ArtifactParams>;

export type ArtifactParamKey = (typeof ARTIFACT_PARAM_KEYS)[number];

/**
 * Which params each slug honors.
 *
 * A mirror of `_SLUG_PARAMS` in `services/render-svc/render_svc/artifacts.py`,
 * which lives in **this repo** — so the copy is checked rather than trusted:
 * `tests/artifacts/slug-params-parity.test.ts` parses the Python literal and
 * fails on any divergence. Without that test this would be a fourth
 * hand-maintained vocabulary, which is the failure G.54 exists to end.
 *
 * A slug absent from this map accepts no params at all (render-svc 422s any).
 *
 * This map records *applicability*, not the accepted value set. `window` is
 * applicable to `cumulative_return_strip` and to `historical_risk_waterfall`,
 * and each module accepts a different subset of the seven window values. That
 * narrowing is a module-side fact measured only by asking, so it is left to
 * render-svc's 422 rather than copied here where it would go stale silently.
 */
export const ARTIFACT_SLUG_PARAMS: Readonly<
  Record<string, readonly ArtifactParamKey[]>
> = {
  top_holdings_erm_stacked: ["top_n"],
  cumulative_return_strip: ["window"],
  position_cumulative_decomposition: ["window"],
  l3_explained_risk_hbar: ["layers"],
  active_risk_composition: ["layers"],
  hedge_notionals_hbar: ["top_n"],
  watchlist_er_stacked: ["sort_by", "top_n"],
  risk_dna_stacked: ["peer_n", "sort_by"],
  historical_risk_waterfall: ["date", "window"],
  holdings_active_panel: ["benchmark", "top_n"],
};

export interface ArtifactRenderParams {
  slug: string;
  version?: string;
  subject_id: string;
  as_of?: string;
  format?: ArtifactRenderFormat;
  subject_payload?: Record<string, unknown> | null;
  params?: ArtifactParams;
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
 * render-svc has no SDK loader for these, so a miss is a 404/501 naming what
 * exists rather than a live render. What `as_of="latest"` means differs by
 * kind — see `STORE_RESOLVED_LATEST_KINDS`. This is a property of the
 * *subject kind*, not of any one slug — the previous note here recorded it
 * against `cumulative_return_strip` alone, which read as a slug-specific
 * caveat and hid it from every other filer slug.
 */
export const PRERENDERED_SUBJECT_KINDS: readonly ArtifactSubjectKind[] = [
  "filer_13f",
  "cohort",
];

/**
 * Pre-rendered kinds for which `as_of="latest"` resolves to the newest
 * vintage in the store. Mirrors `_STORE_RESOLVED_LATEST_KINDS` in artifacts.py.
 *
 * A cohort research artifact is a publication, so its newest vintage is the
 * latest one by definition. A filer's "latest" means the newest *filing*, which
 * the store cannot vouch for (the pre-render job may lag a quarter), so filers
 * keep the explicit-date contract and use `GET /api/artifacts/as-of` to find
 * the dates.
 */
export const STORE_RESOLVED_LATEST_KINDS: readonly ArtifactSubjectKind[] = ["cohort"];

/** How `as_of="latest"` is resolved for a (slug, subject_kind) pair. */
export type ArtifactLatestResolution = "loader" | "newest_prerendered" | "unsupported";

export function latestResolutionFor(kind: ArtifactSubjectKind): ArtifactLatestResolution {
  if (STORE_RESOLVED_LATEST_KINDS.includes(kind)) return "newest_prerendered";
  if (PRERENDERED_SUBJECT_KINDS.includes(kind)) return "unsupported";
  return "loader";
}

/**
 * The discovery routes a caller needs before forming a render request. Served
 * on the capability document so an agent that only has `list_endpoints` output
 * can find its way to the as-of listing without guessing a path.
 */
export const ARTIFACT_DISCOVERY_ROUTES = {
  capability: "GET /api/artifacts/capability?subject_kind=&slug=",
  as_of: "GET /api/artifacts/as-of?slug=&subject_id=&version=",
} as const;

/**
 * Subject kinds render-svc resolves from a prefix but has no way to serve.
 *
 * `etf` is a first-class entry in `_SUBJECT_PREFIX_KIND`, so `BW-ETF-AAA`
 * parses; nothing behind it does. There is no ETF loader, no adapter, no
 * pre-rendered GCS prefix, and no capability entry for any slug — every
 * `BW-ETF-*` render 501s. That was true silently: the kind's absence from
 * `ARTIFACT_RENDER_CAPABILITY` was indistinguishable from an unaudited gap.
 *
 * Recorded rather than removed. Removing `etf` would diverge this list from
 * render-svc's prefix table, which is the one thing it exists to mirror, and
 * ETFs do file N-PORT — the kind is unimplemented, not wrong. `date` for the
 * decision: 2026-08-02 (G.55).
 */
export const UNIMPLEMENTED_SUBJECT_KINDS: Readonly<
  Partial<Record<ArtifactSubjectKind, string>>
> = {
  etf: [
    "render-svc resolves the BW-ETF- prefix but has no ETF loader, adapter or",
    "pre-rendered content for any slug, so every render 501s. Real-but-unimplemented:",
    "ETFs do file N-PORT, and the kind is kept to mirror _SUBJECT_PREFIX_KIND.",
  ].join(" "),
};

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
 *
 * 2026-08-02 (G.53/G.55): re-probed against prod. `watchlist_er_stacked`'s peer
 * mode was found live and promoted out of its "not yet deployed" note; three
 * previously **unprobed** pairs were measured and recorded `unavailable`. Counts
 * are now 21 verified / 9 unavailable across 23 slugs — and this table is served
 * over HTTP at `GET /api/artifacts/capability`, derived, so a client can ask what
 * renders for a subject kind instead of inferring it from a failure payload.
 *
 * This table — not the BWMACRO generated catalog — is the authority on
 * *capability*. The generated catalog scans a source tree and can therefore only
 * report what a module DECLARES; the 2026-08-01 audit found three slugs declared
 * fund-capable with no adapter behind them, which no scan can see. The catalog
 * owns authoring inventory (what renderers exist, which papers use them); this
 * owns what the deployed service actually serves.
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
        "Two modes, both live. (1) Watchlist: requires subject_payload.tickers; " +
        "subject_id BW-STOCK-WATCHLIST. (2) Peer group (G.43): subject_id " +
        "BW-STOCK-{TICKER} with no payload renders the target vs its top-6 " +
        "market-cap peers from /api/peers, with broadening warnings and an " +
        "explicit empty state. The peer mode was advertised here as 'not yet " +
        "deployed' after the 2026-08-01 audit; re-probed against prod 2026-08-02 " +
        "and it serves — BW-STOCK-AAPL returned 7 rows (AAPL + DELL/ANET/STX/WDC/" +
        "SNDK/E) with peer_group.group_etf=RSPT and no warnings. Slow: no " +
        "pre-render, live decompose fan-out (G.32 applies — never eagerly mount).",
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
  // Three pairs the 2026-08-01 audit never probed (G.55). They were absent
  // from `artifact_serving_audit.json` entirely, which the BWMACRO catalog
  // generator's `continue` rendered as *clean* rather than *unmeasured*.
  // Probed against prod render-svc 2026-08-02; all three answered, none served.
  dd_peer_dna: {
    stock: {
      status: "unavailable",
      reason:
        "Batch-rendered for a hot-ticker cohort only, and no GCS prefix " +
        "dd_peer_dna@v1/ exists in the artifact bucket — render-svc 501s " +
        "('not pre-rendered for AAPL'). Measured 2026-08-02.",
    },
  },
  historical_risk_waterfall: {
    stock: {
      status: "unavailable",
      reason:
        "No stock adapter wired (render-svc names the four O.6 panels that are), " +
        "and no GCS prefix exists. 501 for BW-STOCK-AAPL. Measured 2026-08-02. " +
        "Its `date` + `window` params are declared in _SLUG_PARAMS and reachable " +
        "through the request schema — the 501 comes from the adapter lookup, " +
        "after param validation.",
    },
  },
  active_share_skill_scatter: {
    cohort: {
      status: "unavailable",
      reason:
        "Declared for the phantom `fund_cohort` kind until 2026-08-02 (no subject " +
        "id could ever resolve to it — see UNIMPLEMENTED_SUBJECT_KINDS' sibling " +
        "note in contracts.ts). Re-declared against the kind BW-COHORT- actually " +
        "resolves to, which makes it probeable: it is pre-rendered-only and no " +
        "active_share_skill_scatter@v1/ prefix exists in the bucket " +
        "(GET /artifacts/as-of returns count=0), so every call 501s. Measured " +
        "2026-08-02.",
    },
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

/* -------------------------------------------------------------------------- */
/* The read surface (G.53)                                                     */
/* -------------------------------------------------------------------------- */

/** One advertisable (slug, subject_kind) pair. */
export interface ArtifactCapabilityPair {
  slug: string;
  version: string;
  subject_kind: ArtifactSubjectKind;
  /** Params the slug honors; `[]` means the slug takes none. */
  params: readonly ArtifactParamKey[];
  /** True when render-svc can only read pre-rendered GCS content for this kind. */
  prerendered: boolean;
  /**
   * What `as_of="latest"` does for this pair: `loader` (live data), `newest_prerendered`
   * (the newest vintage in the store — cohorts), or `unsupported` (pass an ISO
   * date from `GET /api/artifacts/as-of` — filers).
   */
  as_of_latest: ArtifactLatestResolution;
  notes?: string;
}

/** One measured-but-not-servable pair, with the reason it was refused. */
export interface ArtifactUnavailablePair {
  slug: string;
  subject_kind: ArtifactSubjectKind;
  status: "degraded" | "unavailable";
  reason: string;
}

export interface ArtifactCapabilityDocument {
  /** Where every field below is computed from — never hand-maintained. */
  derived_from: string;
  /** Routes to call before a render: this one, and the as-of vintage listing. */
  discovery: typeof ARTIFACT_DISCOVERY_ROUTES;
  subject_kinds: readonly ArtifactSubjectKind[];
  prerendered_subject_kinds: readonly ArtifactSubjectKind[];
  /** Pre-rendered kinds whose `as_of=latest` resolves to the newest stored vintage. */
  store_resolved_latest_kinds: readonly ArtifactSubjectKind[];
  /** Kinds render-svc resolves but cannot serve, with the reason. */
  unimplemented_subject_kinds: Readonly<Partial<Record<ArtifactSubjectKind, string>>>;
  params: {
    /** Every key render-svc's request schema accepts. */
    vocabulary: readonly ArtifactParamKey[];
    /** Applicability per slug; render-svc 422s anything outside it. */
    by_slug: Readonly<Record<string, readonly ArtifactParamKey[]>>;
  };
  /** Only `verified` pairs. Nothing else may ever appear here. */
  pairs: readonly ArtifactCapabilityPair[];
  /** Recorded so a caller can tell "refused" from "never asked". */
  unavailable: readonly ArtifactUnavailablePair[];
  counts: { verified: number; unavailable: number; slugs: number };
}

/**
 * Build the capability document served by `GET /api/artifacts/capability`.
 *
 * Derived from `ARTIFACT_RENDER_CAPABILITY` on every call. That is the whole
 * design constraint: a hand-written response object could advertise a pair
 * nobody verified, and the reason this endpoint exists at all is that the one
 * reconciled list in the codebase was reachable only from inside an
 * `if (!result.ok)` failure payload.
 *
 * `subjectKind` narrows the `pairs` list — the canvas's actual question is
 * "what renders for this subject?", not "what exists". `unavailable` is not
 * narrowed: a client asking about `fund` still benefits from seeing that
 * `narrative_profile/fund` was measured and refused.
 */
export function buildArtifactCapability(opts?: {
  subjectKind?: ArtifactSubjectKind;
  slug?: string;
}): ArtifactCapabilityDocument {
  const pairs: ArtifactCapabilityPair[] = [];
  const unavailable: ArtifactUnavailablePair[] = [];

  for (const [slug, byKind] of Object.entries(ARTIFACT_RENDER_CAPABILITY)) {
    for (const [rawKind, cap] of Object.entries(byKind)) {
      if (!cap) continue;
      const kind = rawKind as ArtifactSubjectKind;
      if (cap.status === "verified") {
        pairs.push({
          slug,
          version: "v1",
          subject_kind: kind,
          params: ARTIFACT_SLUG_PARAMS[slug] ?? [],
          prerendered: PRERENDERED_SUBJECT_KINDS.includes(kind),
          as_of_latest: latestResolutionFor(kind),
          ...(cap.notes ? { notes: cap.notes } : {}),
        });
      } else {
        unavailable.push({
          slug,
          subject_kind: kind,
          status: cap.status,
          reason: cap.reason ?? "",
        });
      }
    }
  }

  const filtered = pairs.filter(
    (p) =>
      (!opts?.subjectKind || p.subject_kind === opts.subjectKind) &&
      (!opts?.slug || p.slug === opts.slug),
  );
  const sortPair = (a: { slug: string; subject_kind: string }, b: typeof a) =>
    a.slug === b.slug
      ? a.subject_kind.localeCompare(b.subject_kind)
      : a.slug.localeCompare(b.slug);

  return {
    derived_from: "lib/artifacts/render-client.ts::ARTIFACT_RENDER_CAPABILITY",
    discovery: ARTIFACT_DISCOVERY_ROUTES,
    subject_kinds: ARTIFACT_SUBJECT_KINDS,
    prerendered_subject_kinds: PRERENDERED_SUBJECT_KINDS,
    store_resolved_latest_kinds: STORE_RESOLVED_LATEST_KINDS,
    unimplemented_subject_kinds: UNIMPLEMENTED_SUBJECT_KINDS,
    params: {
      vocabulary: ARTIFACT_PARAM_KEYS,
      by_slug: ARTIFACT_SLUG_PARAMS,
    },
    pairs: [...filtered].sort(sortPair),
    unavailable: [...unavailable].sort(sortPair),
    counts: {
      verified: filtered.length,
      unavailable: unavailable.length,
      slugs: new Set(filtered.map((p) => p.slug)).size,
    },
  };
}

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
    // render-svc's own 404 lists the dates that do exist, and the public
    // as-of route answers the question directly, so point at that rather
    // than repeating dates this side cannot know. The path named here is
    // the one that serves on riskmodels.app — never render-svc's internal one.
    const listing = `GET /api/artifacts/as-of?slug=${slug}&subject_id=${subjectId}`;
    hints.push(
      STORE_RESOLVED_LATEST_KINDS.includes(kind)
        ? `as_of='latest' resolves to the newest pre-rendered vintage, so this subject has none for this slug — ${listing} lists what exists.`
        : `as_of='latest' is never valid here — call ${listing} for the dates that exist.`,
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
 * `BW-COHORT-` always resolves to `cohort`. The `.net` contract used to declare
 * a second kind `fund_cohort` against the *same* prefix, which meant no subject
 * id could ever resolve to it and `active_share_skill_scatter/fund_cohort` was
 * permanently unrenderable while reading as declared. It was retired on
 * 2026-08-02 (G.55) on both sides; the scatter now declares `cohort`, which is
 * what its `BW-COHORT-RES-*` subjects actually are.
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

/* -------------------------------------------------------------------------- */
/* Pre-rendered vintage listing                                                */
/* -------------------------------------------------------------------------- */

/** One pre-rendered date for a (slug, subject), with what is stored under it. */
export interface ArtifactVintage {
  as_of: string;
  /** Formats stored without a params fragment (the default render). */
  formats: string[];
  /** Params fragments stored alongside, e.g. `peer_n-5`. */
  params_variants: string[];
  /** Object URI per default-render format. */
  gcs_path: Record<string, string>;
}

export interface ArtifactVintagesSuccess {
  ok: true;
  slug: string;
  version: string;
  requested_subject_id: string;
  canonical_subject_id: string;
  subject_id_spellings_searched: string[];
  /** Date-only view of `vintages`, oldest first. */
  as_of: string[];
  /** Newest date, or null when nothing is pre-rendered. */
  latest: string | null;
  vintages: ArtifactVintage[];
  count: number;
  /** False when the slug holds nothing for any subject (unbuilt slug). */
  slug_populated: boolean;
}

export type ArtifactVintagesResult = ArtifactVintagesSuccess | ArtifactRenderFailure;

/**
 * List the pre-rendered vintages for a (slug, subject) via render-svc's
 * `GET /artifacts/as-of`. Read-only; no render is triggered. This is what
 * `as_of=latest` resolves against for cohort subjects and what a filer caller
 * must consult to pick an explicit date.
 */
export async function listArtifactVintages(params: {
  slug: string;
  subject_id: string;
  version?: string;
}): Promise<ArtifactVintagesResult> {
  const base = renderSvcUrl();
  if (!base) {
    return {
      ok: false,
      status: 503,
      error:
        "RENDER_SVC_URL is not configured. Artifact registry listings require the render-svc Cloud Run service (see services/render-svc/RUNBOOK.md).",
    };
  }

  let authz: string | undefined;
  try {
    authz = await authorizationHeaderForCloudRun(base);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 502, error: `Failed to mint Cloud Run ID token: ${msg}` };
  }

  const qs = new URLSearchParams({
    slug: params.slug,
    subject_id: params.subject_id,
    version: params.version ?? "v1",
  });
  const headers: Record<string, string> = {};
  if (authz) headers.Authorization = authz;

  let res: Response;
  try {
    res = await fetch(`${base}/artifacts/as-of?${qs.toString()}`, { headers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 502, error: `render-svc unreachable: ${msg}` };
  }

  const text = await res.text();
  const body = parseJsonBody(text);
  if (!res.ok) {
    const detail =
      body && typeof body === "object" && "detail" in body
        ? (body as { detail: unknown }).detail
        : body;
    return {
      ok: false,
      status: res.status,
      error:
        typeof detail === "string" ? detail : `render-svc returned HTTP ${res.status}`,
      detail,
    };
  }

  const b = (body ?? {}) as Partial<ArtifactVintagesSuccess>;
  const vintages = Array.isArray(b.vintages) ? b.vintages : [];
  const asOf = Array.isArray(b.as_of) ? b.as_of : vintages.map((v) => v.as_of);
  return {
    ok: true,
    slug: b.slug ?? params.slug,
    version: b.version ?? params.version ?? "v1",
    requested_subject_id: b.requested_subject_id ?? params.subject_id,
    canonical_subject_id: b.canonical_subject_id ?? params.subject_id,
    subject_id_spellings_searched: b.subject_id_spellings_searched ?? [params.subject_id],
    as_of: asOf,
    latest: b.latest ?? (asOf.length ? asOf[asOf.length - 1] : null),
    vintages,
    count: typeof b.count === "number" ? b.count : asOf.length,
    slug_populated: Boolean(b.slug_populated ?? vintages.length > 0),
  };
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
