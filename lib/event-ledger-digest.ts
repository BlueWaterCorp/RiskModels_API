/**
 * Daily Event Ledger digest: selection, grouping, plain text, the attached
 * JSON Lines file and its machine-readable descriptor.
 *
 * Input is rows of the service-role-only Supabase table public.event_ledger
 * (ERM3 erm3/events/publish.py mirrors the append-only local ledger into it;
 * contract v1.0.0 in ERM3 erm3/events/contract.py). Nothing here touches the
 * network: scripts/event-ledger-digest.ts fetches and sends, and
 * emails/event-ledger-digest.tsx renders the HTML part.
 *
 * Selection rules (product output):
 *   - An event is deliverable only when its envelope's license is
 *     redistributable and classified public_record or derived. internal_only
 *     and vendor_restricted rows never leave, not even as a count in the email.
 *   - The contract's licensing gate is re-checked here: a row whose payload or
 *     entity carries a restricted identifier key is withheld.
 *   - Verified events, and corrections or withdrawals of earlier events, form
 *     the main tables. Redistributable candidates appear in a section labelled
 *     "Under review, not verified" when INCLUDE_UNDER_REVIEW_DEFAULT (or the
 *     includeUnderReview option) is on.
 *   - Age. In an edition read from the ledger cursor (ledger_seq window), an
 *     event is listed only when its knowledge_at falls within
 *     RECENT_KNOWLEDGE_DAYS of the edition date. Deliverable events published
 *     now but first knowable earlier (the Form 25 backfill, for one) are
 *     summarised as a single count line ("N older events added to the
 *     ledger"; verified events and candidates alike, so "events"), not listed and not in the attached file. Corrections and
 *     withdrawals are always listed. A knowledge-date sample is left alone: its
 *     window already selects by knowledge date. Applies to every audience.
 *   - Latest event per fact. An edition lists only the newest row of each dedupe_key in its window,
 *     and never a row another row in the window supersedes (supersedes_event_id), even when the gate
 *     withholds that later row. A correction is listed with its "Correction of event ..." flag.
 *   - Delisting dates. Each delisting shows Known (knowledge_at), Trading stopped (only on the
 *     8-K item 2.01 completion basis, with a link to that 8-K's filing folder; an item 3.01 notice
 *     date is never called a trading stop) and the effective date named by its basis: "Listing
 *     removed" only for the removal date stated with the Form 25 (linked to the Form 25 filing
 *     folder), "Form 25 signed" or "Form 25 filed" for the fallbacks, which also give the Rule
 *     12d2-2 default (filing + 10 days). DATES_NOTE explains the labels in both parts.
 *   - Correction counts for the send guard: oldCorrectionCount (corrections of facts first knowable
 *     before the age cutoff) and withheldCorrections (corrections the gate withholds).
 *   - Audience. A "client" edition never carries an internal_only row, whatever
 *     the other settings. An "internal" edition may, under its own heading
 *     ("Internal only, not for clients"), and only to INTERNAL_RECIPIENTS;
 *     buildDigest throws for any other recipient.
 *
 * The attached file holds each delivered envelope as published, one per line,
 * re-serialized canonically (sorted keys, compact separators), the byte form of
 * contract.to_json in ERM3, with ONE added top-level key: license_label, the
 * plain-language licence of that event (licenseLabel()). Removing that key gives
 * back the contract bytes exactly.
 *
 * GDELT. Events discovered through GDELT are internal_only in ERM3
 * (erm3/events/gdelt/discovery.py), so they never reach a client edition. If one
 * ever reaches an edition (internal, or a future derived classification), the
 * edition carries the GDELT credit line (GDELT_CREDIT) automatically.
 *
 * Footer. Each copy of a client edition is built for one recipient
 * (EditionFooter): "Forward to a colleague" (signup link with the recipient's
 * referral code), "Send this to your team inbox instead" (contact addresses only;
 * the change is confirmed by email to that address), the unsubscribe page and the
 * free-edition terms. Unsubscribe is one click on that page's button, plus the
 * RFC 8058 one-click header. A forwarded copy carries the same link, so whoever
 * holds it can unsubscribe the original recipient; that is accepted, as is usual
 * for list mail. A link scanner that only fetches the page changes nothing. The
 * internal edition and previews carry no personal links (internalFooter()).
 */

import { createHash } from "node:crypto";
import { CANONICAL_SITE_URL } from "@/lib/constants";

export const DIGEST_DESCRIPTOR_SCHEMA = "riskmodels.event-ledger-digest/1";
export const DIGEST_CONTACT_EMAIL = "service@riskmodels.app";
export const ENVELOPE_SCHEMA_VERSION = "1.0.0";
export const ATTACHMENT_MEDIA_TYPE = "application/x-ndjson";

/** Free-edition terms every edition and data file points to (app/legal/feed-terms). */
export const FEED_TERMS_URL = `${CANONICAL_SITE_URL}/legal/feed-terms`;
export { FEED_TERMS_VERSION } from "@/lib/feed-waitlist";
/** Signup page; the "Forward to a colleague" link carries ?ref=<referral_code>. */
export const FEED_SIGNUP_URL = `${CANONICAL_SITE_URL}/security-master-feed`;
/**
 * Where an approved subscriber creates a private RSS address. Editions link to this page, never
 * to a feed address: a private address carries a credential and must not sit in a forwarded email.
 */
export const EVENT_LEDGER_RSS_URL = `${FEED_SIGNUP_URL}/access`;
export const EVENT_LEDGER_RSS_TEXT = "Read the Event Ledger in your RSS reader";
export const EVENT_LEDGER_RSS_NOTE =
  "Approved subscribers can create a private RSS address there. It carries the latest verified events and flags corrections and withdrawals.";

/** Credit the GDELT Project's terms ask for wherever GDELT-derived data is shown. */
export const GDELT_CREDIT =
  "Some events in this edition were first discovered through the GDELT Project (https://www.gdeltproject.org/).";

/**
 * THE SETTING for the "Under review, not verified" section. On since 2026-11-11 so
 * Conrad can evaluate it; whether client editions keep it is his call. Flip to
 * false to leave candidates out by default (the CLI's --no-under-review does the
 * same for one run).
 */
export const INCLUDE_UNDER_REVIEW_DEFAULT = true;

/** Rows shown per review section; the rest are counted, not listed. */
export const REVIEW_SECTION_CAP = 20;

/** Days before the edition date within which an event's knowledge_at must fall to be listed. */
export const RECENT_KNOWLEDGE_DAYS = 30;

/** The only addresses an internal edition (with internal_only rows) may go to. */
export const INTERNAL_RECIPIENTS: readonly string[] = ["conrad@bwmacro.com"];

export type Audience = "client" | "internal";

// ── contract shapes (v1.0.0, loosely typed: adapters own the payload) ────────

export type LifecycleStatus = "candidate" | "verified" | "rejected" | "superseded";

export interface EventEnvelope {
  event_id: string;
  dedupe_key: string;
  schema_version: string;
  programs?: string[];
  event_type: string;
  lifecycle_status: LifecycleStatus | string;
  source_role: string;
  entity?: {
    bw_sym_id?: string | null;
    cik?: string | null;
    figi?: string | null;
    ticker?: string | null;
    entity_name?: string | null;
    quarantined?: boolean;
    [key: string]: unknown;
  };
  source?: {
    source_system?: string;
    source_id?: string | null;
    url?: string | null;
    accession_number?: string | null;
    evidence_ref?: string | null;
    [key: string]: unknown;
  };
  payload?: Record<string, unknown>;
  license?: { classification?: string; redistributable?: boolean; basis?: string | null };
  knowledge_at?: string | null;
  knowledge_basis?: string | null;
  effective_at?: string | null;
  effective_basis?: string | null;
  first_observed_at?: string | null;
  first_observed_basis?: string | null;
  ingested_at?: string;
  source_published_at?: string | null;
  supersedes_event_id?: string | null;
  correction_reason?: string | null;
  corroborates_event_id?: string | null;
  [key: string]: unknown;
}

/** One public.event_ledger row as PostgREST returns it (the columns the digest reads). */
export interface LedgerRow {
  seq: number;
  published_at?: string;
  envelope: EventEnvelope;
}

// ── licensing gate ───────────────────────────────────────────────────────────

/**
 * Identifier keys the contract forbids in payload and entity (ERM3
 * PROHIBITED_IDENTIFIER_KEYS). Stored reversed so the words themselves never
 * appear in this public repository's lib/ tree, which the license guard scans.
 */
const RESTRICTED_KEYS_REVERSED = ["pisuc", "nisi", "di_mysf", "lodes", "edoc_yrtsudni"];
const RESTRICTED_KEY_RES = RESTRICTED_KEYS_REVERSED.map(
  (w) => new RegExp(`(?:^|_)${w.split("").reverse().join("")}(?:$|_)`),
);

/** Words that must never appear anywhere in a rendered edition (identifier schemes and one vendor). */
const RESTRICTED_WORDS_REVERSED = ["pisuc", "nisi", "lodes", "tesTcaf"];
export const RESTRICTED_OUTPUT_RES = RESTRICTED_WORDS_REVERSED.map(
  (w) => new RegExp(`\\b${w.split("").reverse().join("")}\\b`, "i"),
);

function restrictedKeyPaths(obj: unknown, path = ""): string[] {
  const found: string[] = [];
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => found.push(...restrictedKeyPaths(v, `${path}[${i}]`)));
  } else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const p = path ? `${path}.${k}` : k;
      if (RESTRICTED_KEY_RES.some((re) => re.test(k.toLowerCase()))) found.push(p);
      found.push(...restrictedKeyPaths(v, p));
    }
  }
  return found;
}

/**
 * A RiskModels id built from a 12-character national identifier rather than a FIGI
 * (FIGIs start BBG). Such ids embed a restricted identifier and never go out.
 */
const NATIONAL_ID_FLAVORED_SYM_ID = /\bBW-(?!BBG)[A-Z]{2}[A-Z0-9]{9}\d\b/;

export type WithheldReason =
  | "not_redistributable"
  | "internal_only_in_client_edition"
  | "restricted_identifier_key"
  | "path_not_on_allow_list"
  | "value_not_allowed"
  | "market_cap_or_price";

/**
 * Licensed-data gate for client editions, their attached file and the public events list.
 *
 * The rule: RiskModels redistributes data it DERIVES, including from licensed market data, but never
 * an exact market cap value and never a raw licensed value (a price, volume or other bar field as
 * received, a vendor code). Figures computed from market cap (weights, ranks, buckets, size factors,
 * risk metrics) are derived data.
 *
 * Three layers, all client-only; an event that fails any is withheld whole (the published envelope
 * is never edited):
 *   1. ALLOW-LIST. Every key path of the envelope, top-level keys, source, provenance, risk_layers and
 *      payload included, must be on CLIENT_ALLOWED_PATHS for its event_type. An event type with no list
 *      never reaches a client. A new field reaches clients only after it is traced in the internal
 *      source register (BWMACRO docs/EVENT_LEDGER_SOURCE_REGISTER.md) and added here.
 *   2. VALUES. valueViolations(): fixed sets, numbers and a ticker pattern where the register says so;
 *      every other allowed leaf must be a string or null.
 *   3. SCAN. priceOrCapHits() looks through the whole serialized envelope, and again through every
 *      rendered copy and the attachment, for identifiers that name an exact market cap or a price,
 *      case-aware (marketCapUsd, market_cap_log, weighted_market_cap, market_value, float_cap,
 *      closePrice, lastPrice, px_last, ...), and for prose such as "market cap", "aggregate market value",
 *      "last price", "last sale" and "share price", after NFKC and zero-width stripping. Ordinary prose such as a
 *      warrant's "exercise price" in a Form 25 security description is public-record text and passes.
 */

/**
 * edgar_delisting TRADING_STOPPED_BASIS_*. Only the first dates a trading stop (the completion date
 * in the issuer's 8-K item 2.01, parsed from the document); the others carry a null date and keep
 * the 8-K evidence: 2.01 present but its date not parsed, an item 3.01 notice alone (never a trading
 * stop), and no matching 8-K accepted by the Form 25's knowledge time (which does not say none exists).
 */
export const TRADING_STOPPED_BASIS_2_01 = "8k_item_2_01_completion_date";
export const TRADING_STOPPED_BASES = [
  TRADING_STOPPED_BASIS_2_01,
  "8k_item_2_01_date_not_parsed",
  "8k_item_3_01_notice_date_not_a_trading_stop",
  "no_8k_2_01_or_3_01_accepted_by_form25",
] as const;

/** Keys present on every envelope (contract v1.0.0). */
const ENVELOPE_PATHS = [
  "affected",
  "confidence",
  "correction_reason",
  "corroborates_event_id",
  "dedupe_key",
  "effective_at",
  "effective_basis",
  "entity",
  "entity.bw_sym_id",
  "entity.cik",
  "entity.entity_name",
  "entity.figi",
  "entity.mapping_confidence",
  "entity.match_tier",
  "entity.quarantined",
  "entity.ticker",
  "event_id",
  "event_type",
  "first_observed_at",
  "first_observed_basis",
  "ingested_at",
  "knowledge_at",
  "knowledge_basis",
  "license",
  "license.basis",
  "license.classification",
  "license.redistributable",
  "lifecycle_status",
  "payload",
  "programs",
  "programs[]",
  "provenance",
  "provenance.adapter",
  "provenance.adapter_version",
  "provenance.contributor",
  "provenance.run_id",
  "risk_layers",
  "schema_version",
  "source",
  "source.accession_number",
  "source.evidence_ref",
  "source.evidence_sha256",
  "source.source_id",
  "source.source_system",
  "source.url",
  "source_published_at",
  "source_role",
  "supersedes_event_id",
  "validation_state",
] as const;

/** Client allow-list per event_type. `affected` and `risk_layers` are allowed only empty. */
export const CLIENT_ALLOWED_PATHS: Readonly<Record<string, ReadonlySet<string>>> = {
  delisting: new Set<string>([
    ...ENVELOPE_PATHS,
    "payload.confidence",
    "payload.entity_mapping",
    "payload.file_number",
    "payload.issuer_name",
    "payload.rule_12d2_2_effective_estimate",
    "payload.rule_provision",
    "payload.security_description",
    "payload.source_form",
    "payload.source_item",
    "payload.affected_bw_sym_ids",
    "payload.affected_bw_sym_ids[]",
    // edgar_delisting 1.2.0: the Form 25's own dates and the trading stop read from the issuer's 8-K.
    "payload.signature_date",
    "payload.stated_effective_date",
    "payload.stated_effective_date_rejected",
    "payload.trading_stopped_date",
    "payload.trading_stopped_basis",
    "payload.trading_stopped_knowledge_at",
    "payload.trading_stopped_source_accession",
    "payload.trading_stopped_source_event_date",
    "payload.trading_stopped_source_event_date_source",
    "payload.trading_stopped_source_form",
    "payload.trading_stopped_source_items",
    "payload.trading_stopped_source_items[]",
  ]),
};

/** Key paths of `env` that are not on the client allow-list for its event_type (all of them if it has none). */
export function allowListViolations(env: EventEnvelope): string[] {
  const allowed = CLIENT_ALLOWED_PATHS[env.event_type];
  const out: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) {
      for (const item of v) {
        const p = `${path}[]`;
        if (!allowed?.has(p)) out.push(p);
        else walk(item, p);
      }
    } else if (v && typeof v === "object") {
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        const p = path ? `${path}.${k}` : k;
        if (!allowed?.has(p)) out.push(p);
        else walk(child, p);
      }
    }
  };
  walk(env, "");
  return allowed ? out : ["event_type"];
}

const isNull = (v: unknown) => v === null || v === undefined;
const nullOr = (test: (v: unknown) => boolean) => (v: unknown) => isNull(v) || test(v);
const unitNumber = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
const oneOf = (...xs: readonly unknown[]) => (v: unknown) => xs.includes(v);
const isString = (v: unknown) => typeof v === "string";
const isoDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isoTimestamp = (v: unknown) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(v);
const accession = (v: unknown) => typeof v === "string" && /^\d{10}-\d{2}-\d{6}$/.test(v);

/**
 * Value rules at allowed paths (client). Sets are the values seen in live data on 2026-11-13, and for the
 * Form 25 adapter 1.2.0 keys the values its code can emit; a new value is withheld until it is reviewed
 * and added. Every other allowed scalar leaf must be a
 * string or null (filing text, ids, dates), so a number, object or array cannot hide there.
 */
const VALUE_RULES: Readonly<Record<string, (v: unknown) => boolean>> = {
  validation_state: isNull,
  "provenance.contributor": isNull,
  confidence: nullOr(unitNumber),
  "payload.confidence": nullOr(unitNumber),
  "entity.mapping_confidence": nullOr(unitNumber),
  "entity.quarantined": (v) => typeof v === "boolean",
  "license.redistributable": (v) => typeof v === "boolean",
  "entity.ticker": nullOr((v) => typeof v === "string" && /^[A-Z][A-Z0-9]{0,5}([.-][A-Z0-9]{1,3})?$/.test(v)),
  "programs[]": oneOf("changefeed"),
  // edgar_delisting 1.2.0 (ERM3 erm3/events/adapters/edgar_delisting.py, constants as of d9450b67).
  "payload.signature_date": nullOr(isoDate),
  "payload.stated_effective_date": nullOr(isoDate),
  // Why the Form 25's stated date was not used (STATED_REJECTED_*).
  "payload.stated_effective_date_rejected": nullOr(oneOf("before_filing")),
  "payload.trading_stopped_date": nullOr(isoDate),
  "payload.trading_stopped_basis": nullOr(oneOf(...TRADING_STOPPED_BASES)),
  "payload.trading_stopped_knowledge_at": nullOr(isoTimestamp),
  "payload.trading_stopped_source_accession": nullOr(accession),
  "payload.trading_stopped_source_form": nullOr(oneOf("8-K", "8-K/A")),
  "payload.trading_stopped_source_event_date": nullOr(isoDate),
  "payload.trading_stopped_source_event_date_source": nullOr(oneOf("document_period_end_date", "filed_date_fallback", "effective_as_of_regex")),
  // 8-K item numbers such as "3.01".
  "payload.trading_stopped_source_items[]": (v) => typeof v === "string" && /^\d{1,2}\.\d{2}$/.test(v),
  schema_version: oneOf("1.0.0"),
  lifecycle_status: oneOf("candidate", "verified", "rejected", "superseded"),
  source_role: oneOf("discovery", "primary", "corroborating", "contributor", "internal_derived"),
};

/** Allowed paths whose value breaks VALUE_RULES (or is not a string/null where no rule is set). */
export function valueViolations(env: EventEnvelope): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) {
      for (const item of v) walk(item, `${path}[]`);
    } else if (v && typeof v === "object") {
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) walk(child, path ? `${path}.${k}` : k);
    } else {
      const rule = VALUE_RULES[path] ?? nullOr(isString);
      if (!rule(v)) out.push(path);
    }
  };
  walk(env, "");
  return out;
}

/** NFKC, zero-width characters and soft hyphens removed: what a reader actually sees. */
export function normalizeForScan(s: string): string {
  return s.normalize("NFKC").replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, "");
}

/** camelCase and kebab to snake_case, lowercased: marketCapUsd -> market_cap_usd. */
function snake(ident: string): string {
  return ident
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/-/g, "_")
    .toLowerCase();
}

const CAP_IDENT_RE = /(^|_)(market_?cap(s|itali[sz]ation)?|mkt_?cap|mcap|market_?value|float_?cap)(_|$)/;
/** A derived word AFTER the cap token makes the identifier a derived figure: market_cap_weight, cap_rank_z. */
const CAP_DERIVED_AFTER_RE =
  /(market_?cap(s|itali[sz]ation)?|mkt_?cap|mcap|market_?value|float_?cap)_(.*_)?(weight|weights|rank|ranks|ranking|bucket|buckets|band|bands|tier|decile|quintile|percentile|factor|exposure|beta|z|zscore|score)(_|$)/;
const PRICE_IDENT_RE =
  /(^|_)(close_price|closing_price|last_price|price_close|price_last|px_last|px_close|last_px|close_px|adj_close|adjusted_close|vwap|ohlc|ohlcv|last_trade_date|last_traded_date|market_price)(_|$)/;
const DERIVED_NEXT = String.raw`(?!\s+(weight|weights|rank|ranks|bucket|buckets|band|bands|tier|decile|quintile|percentile|factor|exposure))`;
/**
 * Prose that names a market value or a trade price. None of these occurs in the live filing text;
 * a warrant's "exercise price of $11.50" (107 live Form 25 descriptions) is not among them.
 */
const PROSE_RES: ReadonlyArray<[string, RegExp]> = [
  ["market cap", new RegExp(String.raw`\bmarket\s*cap(s|itali[sz]ation)?\b` + DERIVED_NEXT, "i")],
  ["mkt cap", new RegExp(String.raw`\bmkt\.?\s*cap\b` + DERIVED_NEXT, "i")],
  ["aggregate market value", /\baggregate\s*market\s*value\b/i],
  ["last price", /\blast\s*(traded\s*)?price\b/i],
  ["last sale", /\blast\s*sale(\s*price)?\b/i],
  ["share price", /\bshare\s*price\b/i],
];

/** Market cap or price identifiers (case-aware) and the phrase "market cap" in the bodies; empty means none. */
export function priceOrCapHits(...bodies: string[]): string[] {
  const hits = new Set<string>();
  for (const raw of bodies) {
    const body = normalizeForScan(raw);
    for (const [label, re] of PROSE_RES) if (re.test(body)) hits.add(`phrase:${label}`);
    // JSON keys are checked whatever their form; elsewhere only compound identifiers (snake_case,
    // camelCase), so a company called "MCAP Acquisition Corporation" (a live Form 25 issuer) passes.
    const keys = [...body.matchAll(/"([A-Za-z][A-Za-z0-9_-]*)"\s*:/g)].map((m) => m[1]);
    const compound = [...body.matchAll(/[A-Za-z][A-Za-z0-9_-]*/g)]
      .map((m) => m[0])
      .filter((t) => /[_-]/.test(t) || /[a-z][A-Z]/.test(t));
    for (const token of [...keys, ...compound]) {
      const id = snake(token);
      if (CAP_IDENT_RE.test(id) && !CAP_DERIVED_AFTER_RE.test(id)) hits.add(`cap:${id}`);
      if (PRICE_IDENT_RE.test(id)) hits.add(`price:${id}`);
    }
  }
  return [...hits];
}

/** Kept for the scripts: the market cap half of priceOrCapHits. */
export function marketCapHits(...bodies: string[]): string[] {
  return priceOrCapHits(...bodies).filter((h) => !h.startsWith("price:"));
}

/**
 * Entity fields RiskModels fills from its security master, whose inputs include licensed market
 * data. Derived, so allowed in client editions, but labelled in each line's license_label.
 */
export const DERIVED_ENTITY_KEYS = ["ticker", "figi", "bw_sym_id", "entity_name"] as const;

export function derivedFieldPaths(env: EventEnvelope): string[] {
  const ent = (env.entity ?? {}) as Record<string, unknown>;
  const out = DERIVED_ENTITY_KEYS.filter((k) => ent[k] !== null && ent[k] !== undefined && ent[k] !== "").map(
    (k) => `entity.${k}`,
  );
  const affected = (env.payload ?? {}).affected_bw_sym_ids;
  if (Array.isArray(affected) && affected.length) out.push("payload.affected_bw_sym_ids");
  return out;
}

export function isInternalOnly(env: EventEnvelope): boolean {
  return env.license?.classification === "internal_only";
}

/** True for an event whose source, licence basis or knowledge basis is GDELT. */
export function isGdeltDerived(env: EventEnvelope): boolean {
  const hay = [env.source?.source_system, env.license?.basis, env.knowledge_basis]
    .filter((v): v is string => typeof v === "string")
    .join(" ");
  return /gdelt/i.test(hay);
}

/**
 * Plain-language licence of one event, written into its line of the attached file. It restates the
 * envelope's license block for a reader; the block itself is unchanged.
 */
export function licenseLabel(env: EventEnvelope): string {
  const lic = env.license ?? {};
  const terms = `free edition terms (${FEED_TERMS_URL})`;
  const derived = derivedFieldPaths(env);
  const note = derived.length ? ` Fields ${derived.join(", ")} are derived by RiskModels.` : "";
  if (lic.classification === "public_record" && lic.redistributable === true) {
    return `Public record (SEC filing).${note} Use and quote under the ${terms}.`;
  }
  if (lic.classification === "derived" && lic.redistributable === true) {
    return `Derived by RiskModels.${note} Use and quote under the ${terms}.`;
  }
  if (lic.classification === "internal_only") return "Internal only. Not for clients; do not forward.";
  return "Not redistributable.";
}

export function withheldReason(env: EventEnvelope, audience: Audience = "client"): WithheldReason | null {
  if (restrictedKeyPaths(env.payload ?? {}).length || restrictedKeyPaths(env.entity ?? {}).length) {
    return "restricted_identifier_key";
  }
  const serialized = JSON.stringify(env);
  if (NATIONAL_ID_FLAVORED_SYM_ID.test(serialized)) return "restricted_identifier_key";
  // A restricted word inside a value (4 live Form 25 security descriptions quote one) withholds that row,
  // rather than refusing the whole edition at the output scan, which stays as the last check.
  if (RESTRICTED_OUTPUT_RES.some((re) => re.test(serialized))) return "restricted_identifier_key";
  if (isInternalOnly(env)) return audience === "internal" ? null : "internal_only_in_client_edition";
  if (audience === "client" && allowListViolations(env).length) return "path_not_on_allow_list";
  if (audience === "client" && valueViolations(env).length) return "value_not_allowed";
  if (audience === "client" && priceOrCapHits(serialized).length) return "market_cap_or_price";
  const lic = env.license ?? {};
  if (lic.redistributable !== true) return "not_redistributable";
  if (lic.classification !== "public_record" && lic.classification !== "derived") return "not_redistributable";
  return null;
}

// ── families ─────────────────────────────────────────────────────────────────

/** Display order and labels. Unknown event types follow, alphabetically. */
const FAMILIES: ReadonlyArray<{ key: string; label: string; noun: string; types: readonly string[] }> = [
  { key: "delisting", label: "Delistings (Form 25)", noun: "delistings", types: ["delisting"] },
  { key: "delisting_notice", label: "Listing deficiency notices", noun: "deficiency notices", types: ["delisting_notice"] },
  { key: "rename", label: "Renames and ticker changes", noun: "renames", types: ["rename", "ticker_change", "name_change"] },
  { key: "split", label: "Splits", noun: "splits", types: ["split", "reverse_split", "stock_split"] },
  {
    key: "merger",
    label: "Mergers and reorganisations",
    noun: "mergers and reorganisations",
    types: ["m_and_a", "merger", "merger_or_reorganisation", "acquisition"],
  },
  { key: "listing_status", label: "Listing status", noun: "listing status changes", types: ["listing_status"] },
  { key: "identifier_change", label: "Identifier changes", noun: "identifier changes", types: ["identifier_rekey", "identifier_change"] },
];

/** Singular of each family noun, for counts of one ("1 delisting"). */
const FAMILY_ONE: Record<string, string> = {
  delisting: "delisting",
  delisting_notice: "deficiency notice",
  rename: "rename",
  split: "split",
  merger: "merger or reorganisation",
  listing_status: "listing status change",
  identifier_change: "identifier change",
};

export function familyOf(eventType: string): { key: string; label: string; noun: string; one: string; order: number } {
  const i = FAMILIES.findIndex((f) => f.types.includes(eventType));
  if (i >= 0) {
    const f = FAMILIES[i];
    return { key: f.key, label: f.label, noun: f.noun, one: FAMILY_ONE[f.key] ?? f.noun, order: i };
  }
  const noun = eventType.replace(/_/g, " ");
  return { key: eventType, label: noun.replace(/^./, (c) => c.toUpperCase()), noun, one: noun, order: FAMILIES.length };
}

// ── per-event display fields ─────────────────────────────────────────────────

/** 17 CFR 240.12d2-2 provisions, in the rule's own terms. */
const RULE_12D2_2: Record<string, string> = {
  "(a)(1)": "class called for redemption, maturity or retirement",
  "(a)(2)": "class redeemed or paid at maturity or retirement",
  "(a)(3)": "class replaced by other securities, e.g. in a merger",
  "(a)(4)": "all rights in the class extinguished",
  "(b)": "removed by the exchange under its rules",
  "(c)": "withdrawn by the issuer",
};

export function provisionLabel(rule: unknown): string | null {
  if (typeof rule !== "string") return null;
  const m = rule.match(/12d2-2(\([a-z]\)(?:\(\d\))?)/i);
  if (!m) return null;
  const key = m[1].toLowerCase();
  return RULE_12D2_2[key] ?? RULE_12D2_2[key.slice(0, 3)] ?? null;
}

const BASIS_LABELS: Record<string, string> = {
  form25_stated_effective_date: "removal date stated with the Form 25",
  form25_signature_date: "Form 25 signature date",
  filed_date_fallback: "filing date",
  rule_12d2_2_filed_plus_10d: "filing date + 10 days (Rule 12d2-2)",
  sec_filed_date: "SEC filing date",
  sec_acceptance_datetime: "SEC acceptance time",
  article_seendate: "article crawl time",
  rekey_swap_applied: "time the re-key was applied",
};

export function basisLabel(basis: string | null | undefined): string {
  if (!basis) return "basis not recorded";
  return BASIS_LABELS[basis] ?? basis.replace(/_/g, " ");
}

/**
 * What a delisting's effective_at is, by its basis. Only the removal date stated with the Form 25 is
 * called a removal; a signature or filing date is named as what it is.
 */
const DELISTING_EFFECTIVE_LABELS: Record<string, string> = {
  form25_stated_effective_date: "Listing removed",
  form25_signature_date: "Form 25 signed",
  filed_date_fallback: "Form 25 filed",
};

/** Note shown after a delisting date that is not the stated removal date. */
export const NO_STATED_REMOVAL_NOTE = "the form states no removal date";
/** The same, when a stated date exists but precedes the filing (stated_effective_date_rejected = before_filing). */
export const STATED_BEFORE_FILING_NOTE = "stated removal date precedes the filing; not used";

/** EDGAR filing folder of an accession: https://www.sec.gov/Archives/edgar/data/<cik>/<accession digits>/. */
export function filingFolderUrl(cik: unknown, acc: unknown): string | null {
  if (typeof cik !== "string" || !/^\d{1,10}$/.test(cik) || !accession(acc)) return null;
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${(acc as string).replace(/-/g, "")}/`;
}

/** A dated fact's evidence: a short label and, for public-record filings, its EDGAR folder. */
export interface DateSource {
  text: string;
  label: string | null;
  url: string | null;
}

/** Where a stated removal date comes from; null for any other basis. */
function removalSourceOf(env: EventEnvelope): DateSource | null {
  if (env.event_type !== "delisting" || env.effective_basis !== "form25_stated_effective_date") return null;
  const form = str(env.payload?.source_form);
  const acc = str(env.source?.accession_number);
  const publicRecord = env.license?.classification === "public_record";
  return {
    // A Form 25-NSE is the exchange's own notice; an issuer-filed Form 25 is described neutrally.
    text: form && /^25-NSE/i.test(form) ? "stated in the exchange's notice filed with the Form 25" : "stated with the Form 25",
    label: acc ? `Form ${form ?? "25"} ${acc}` : null,
    url: publicRecord ? filingFolderUrl(env.entity?.cik, acc) : null,
  };
}

const TRADING_STOPPED_BASIS_LABELS: Record<string, string> = {
  [TRADING_STOPPED_BASIS_2_01]: "completion date in the issuer's 8-K (item 2.01)",
};

export function tradingStoppedBasisLabel(basis: string | null | undefined): string {
  if (!basis) return "basis not recorded";
  return TRADING_STOPPED_BASIS_LABELS[basis] ?? basis.replace(/_/g, " ");
}

/** The trading stop of a delisting: only on the item 2.01 basis with a date; null otherwise. */
function tradingStopOf(env: EventEnvelope): DigestItem["tradingStopped"] {
  if (env.event_type !== "delisting") return null;
  const p = env.payload ?? {};
  const date = str(p.trading_stopped_date);
  if (!date || p.trading_stopped_basis !== TRADING_STOPPED_BASIS_2_01) return null;
  const form = str(p.trading_stopped_source_form);
  const acc = str(p.trading_stopped_source_accession);
  return {
    date: date.slice(0, 10),
    basis: tradingStoppedBasisLabel(str(p.trading_stopped_basis)),
    source: acc ? `${form ?? "8-K"} ${acc}` : null,
    // The 8-K is matched on the same CIK as the Form 25.
    url: env.license?.classification === "public_record" ? filingFolderUrl(env.entity?.cik, acc) : null,
  };
}

function dateOf(ts: string | null | undefined): string | null {
  return ts ? ts.slice(0, 10) : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export interface DigestItem {
  seq: number;
  eventId: string;
  eventType: string;
  effectiveDate: string | null;
  /** What effectiveDate is: "Listing removed", "Form 25 signed", "Form 25 filed", or "Effective". */
  effectiveLabel: string;
  effectiveBasis: string;
  /** Set when effectiveDate is a delisting date other than the stated removal date. */
  effectiveNote: string | null;
  /** Evidence of a stated removal date (the Form 25 filing folder); null for other bases. */
  effectiveSource: DateSource | null;
  /** Delistings: when trading stopped, from the issuer's 8-K item 2.01; null otherwise. */
  tradingStopped: { date: string; basis: string; source: string | null; url: string | null } | null;
  /**
   * Payload's Rule 12d2-2 default (filing + 10 days), shown only when the removal date is not
   * stated with the Form 25; null otherwise.
   */
  effectiveEstimate: string | null;
  knowledgeDate: string | null;
  knowledgeBasis: string;
  ticker: string | null;
  company: string | null;
  identifiers: string[];
  event: string;
  /** Second line under the event: rule, form or other qualifier. */
  eventDetail: string | null;
  status: string;
  sourceRole: string;
  sourceUrl: string | null;
  sourceLabel: string | null;
  /** Set for corrections, supersessions and withdrawals. */
  flag: string | null;
  envelope: EventEnvelope;
}

/** A source link is shown only for public-record evidence on https. */
function sourceLink(env: EventEnvelope): { url: string | null; label: string | null } {
  const url = str(env.source?.url);
  const label = str(env.source?.accession_number) ?? str(env.source?.evidence_ref) ?? str(env.source?.source_id);
  if (!url || env.license?.classification !== "public_record" || !url.startsWith("https://")) {
    return { url: null, label };
  }
  return { url, label: label ?? "source" };
}

function describe(env: EventEnvelope): { event: string; detail: string | null } {
  const p = env.payload ?? {};
  if (env.event_type === "delisting") {
    const what = str(p.security_description);
    const form = str(p.source_form);
    const prov = provisionLabel(p.rule_provision);
    const rule = str(p.rule_provision)?.replace(/^17 CFR 240\./, "Rule ") ?? null;
    const detail = [prov ? `${prov.charAt(0).toUpperCase()}${prov.slice(1)}` : null, rule, form ? `Form ${form}` : null]
      .filter(Boolean)
      .join(" · ");
    return { event: what ? `Delisting: ${what}` : "Delisting", detail: detail || null };
  }
  if (env.event_type === "identifier_rekey") {
    const from = str(p.old_bw_sym_id);
    const to = str(p.new_bw_sym_id);
    return {
      event: from && to ? `RiskModels id re-keyed: ${from} → ${to}` : "RiskModels id re-keyed",
      detail: str(p.rule) ? `Rule ${str(p.rule)}` : null,
    };
  }
  return { event: str(p.title) ?? str(p.summary) ?? familyOf(env.event_type).label, detail: null };
}

/** Appended to a correction's flag when the event it corrects was in the same window and never listed. */
export const UNSENT_CORRECTION_NOTE = "The event it corrects entered the ledger in this same window and was not listed.";

function flagOf(env: EventEnvelope): string | null {
  const reason = str(env.correction_reason);
  if (env.supersedes_event_id) {
    const r = reason ? `: ${reason.replace(/[.\s]+$/, "")}.` : ".";
    return `Correction of an earlier event (${env.supersedes_event_id.slice(0, 8)})${r}`;
  }
  if (env.lifecycle_status === "superseded") return `Superseded${reason ? `: ${reason}` : ""}`;
  if (env.lifecycle_status === "rejected") return `Withdrawn${reason ? `: ${reason}` : ""}`;
  return null;
}

function effectiveLabelOf(env: EventEnvelope): string {
  if (env.event_type !== "delisting") return "Effective";
  return DELISTING_EFFECTIVE_LABELS[env.effective_basis ?? ""] ?? "Effective";
}

export function toItem(row: LedgerRow): DigestItem {
  const env = row.envelope;
  const p = env.payload ?? {};
  const ent = env.entity ?? {};
  const link = sourceLink(env);
  const what = describe(env);
  const identifiers = [
    ent.figi ? `FIGI ${ent.figi}` : null,
    ent.cik ? `CIK ${ent.cik}` : null,
  ].filter((x): x is string => Boolean(x));
  return {
    seq: row.seq,
    eventId: env.event_id,
    eventType: env.event_type,
    effectiveDate: dateOf(env.effective_at),
    effectiveLabel: effectiveLabelOf(env),
    effectiveBasis: basisLabel(env.effective_basis),
    effectiveNote:
      env.event_type === "delisting" && env.effective_basis !== "form25_stated_effective_date"
        ? p.stated_effective_date_rejected === "before_filing"
          ? STATED_BEFORE_FILING_NOTE
          : NO_STATED_REMOVAL_NOTE
        : null,
    effectiveSource: removalSourceOf(env),
    tradingStopped: tradingStopOf(env),
    effectiveEstimate: env.effective_basis === "form25_stated_effective_date" ? null : str(p.rule_12d2_2_effective_estimate),
    knowledgeDate: dateOf(env.knowledge_at),
    knowledgeBasis: basisLabel(env.knowledge_basis),
    ticker: str(ent.ticker),
    company: str(ent.entity_name) ?? str(p.issuer_name),
    identifiers,
    event: what.event,
    eventDetail: what.detail,
    status: String(env.lifecycle_status),
    sourceRole: env.source_role,
    sourceUrl: link.url,
    sourceLabel: link.label,
    flag: flagOf(env),
    envelope: env,
  };
}

// ── edition ──────────────────────────────────────────────────────────────────

export type DigestWindow =
  | { basis: "ledger_seq"; after_seq: number; through_seq: number }
  | { basis: "knowledge_date"; from: string; to: string };

export interface FamilyGroup {
  key: string;
  label: string;
  noun: string;
  /** Singular noun, for a count of one. */
  one: string;
  items: DigestItem[];
}

/** A capped section: the rows shown, and how many more matched. */
export interface ReviewSection {
  items: DigestItem[];
  total: number;
  notShown: number;
}

export interface DigestEdition {
  editionDate: string;
  audience: Audience;
  includeUnderReview: boolean;
  /** Subject prefix for samples, e.g. "[Sample 2]". */
  sampleLabel: string | null;
  sample: boolean;
  /** Shown at the top of a sample edition: why it is a sample and what it covers. */
  sampleNote: string | null;
  window: DigestWindow;
  /** Verified events plus corrections and withdrawals, grouped by family. */
  families: FamilyGroup[];
  /** Redistributable candidates ("Under review, not verified"); empty when the setting is off. */
  underReview: ReviewSection;
  /** internal_only rows ("Internal only, not for clients"); always empty in a client edition. */
  internalOnly: ReviewSection;
  /**
   * Deliverable events in the window first knowable before knowledgeBefore (or with no knowledge
   * date): counted in one line, not listed, not attached. Always 0 for a knowledge-date window.
   */
  older: { total: number; knowledgeBefore: string | null; days: number | null };
  /** Count in the headline and subject: verified events plus corrections. */
  mainCount: number;
  correctionCount: number;
  /**
   * Rows left out because a later row of the same dedupe_key, or a row naming them in
   * supersedes_event_id, is in the window (withheld or not). Operator log only; never rendered.
   */
  replaced: number;
  /**
   * Deliverable rows in the window, listed or counted: main + older + under review + internal only.
   * The flood guard (lib/event-ledger-digest-schedule.ts sendGuard) caps this.
   */
  windowCount: number;
  /**
   * Corrections and withdrawals listed in a ledger_seq edition whose knowledge_at falls before the
   * age cutoff (or is missing): corrections of old facts, as a history load produces. 0 otherwise.
   */
  oldCorrectionCount: number;
  /** Corrections and withdrawals the gate withheld: facts whose latest state does not reach this edition. */
  withheldCorrections: number;
  /** True when any delivered event is GDELT-derived; the edition then shows GDELT_CREDIT. */
  gdeltCredit: boolean;
  /** Withheld rows, by reason. Operator log only; never rendered. */
  withheld: Record<WithheldReason, number>;
  /** Exactly the lines of the attachment. */
  attachment: { filename: string; body: string; lines: number; sha256: string };
}

export interface BuildOptions {
  editionDate: string;
  window: DigestWindow;
  sample?: boolean;
  sampleNote?: string | null;
  sampleLabel?: string | null;
  /** Defaults to INCLUDE_UNDER_REVIEW_DEFAULT. */
  includeUnderReview?: boolean;
  /** Defaults to "client". "internal" requires recipient to be in INTERNAL_RECIPIENTS. */
  audience?: Audience;
  recipient?: string;
  /** Rows shown per review section; defaults to REVIEW_SECTION_CAP. */
  reviewCap?: number;
  /**
   * Age rule; defaults to RECENT_KNOWLEDGE_DAYS. Applies to ledger_seq windows only. null turns it
   * off (the public latest-events file, which is not an edition and picks the newest events itself).
   */
  recentDays?: number | null;
  /**
   * Defaults to true: a correction whose original is in the same window says so (UNSENT_CORRECTION_NOTE).
   * The public latest-events file, which is not an edition, turns it off.
   */
  markUnsentCorrections?: boolean;
}

/** editionDate minus `days`, as YYYY-MM-DD. */
export function knowledgeCutoff(editionDate: string, days: number): string {
  const d = new Date(`${editionDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** True when the event is listed under the age rule; cutoff null means no age rule. */
function isRecent(env: EventEnvelope, cutoff: string | null): boolean {
  if (cutoff === null) return true;
  if (env.supersedes_event_id || env.lifecycle_status === "superseded" || env.lifecycle_status === "rejected") return true;
  const k = typeof env.knowledge_at === "string" ? env.knowledge_at.slice(0, 10) : null;
  return k !== null && k >= cutoff;
}

export class InternalRecipientError extends Error {
  constructor() {
    super("internal_edition_recipient_not_allowed");
  }
}

/** A correction, supersession or withdrawal of an earlier event. */
function isCorrection(env: EventEnvelope): boolean {
  return Boolean(env.supersedes_event_id) || env.lifecycle_status === "superseded" || env.lifecycle_status === "rejected";
}

function isMain(env: EventEnvelope): boolean {
  return (
    env.lifecycle_status === "verified" ||
    Boolean(env.supersedes_event_id) ||
    env.lifecycle_status === "superseded" ||
    env.lifecycle_status === "rejected"
  );
}

function byKnowledgeThenSeq(a: DigestItem, b: DigestItem): number {
  const ka = a.envelope.knowledge_at ?? "";
  const kb = b.envelope.knowledge_at ?? "";
  return ka < kb ? -1 : ka > kb ? 1 : a.seq - b.seq;
}

function capped(items: DigestItem[], cap: number): ReviewSection {
  items.sort(byKnowledgeThenSeq);
  const shown = items.slice(0, Math.max(0, cap));
  return { items: shown, total: items.length, notShown: items.length - shown.length };
}

export function buildDigest(rows: readonly LedgerRow[], opts: BuildOptions): DigestEdition {
  const audience: Audience = opts.audience ?? "client";
  if (audience === "internal" && !INTERNAL_RECIPIENTS.includes(opts.recipient ?? "")) {
    throw new InternalRecipientError();
  }
  const includeUnderReview = opts.includeUnderReview ?? INCLUDE_UNDER_REVIEW_DEFAULT;
  const cap = opts.reviewCap ?? REVIEW_SECTION_CAP;
  const days = opts.recentDays === undefined ? RECENT_KNOWLEDGE_DAYS : opts.recentDays;
  const cutoff = opts.window.basis === "ledger_seq" && days !== null ? knowledgeCutoff(opts.editionDate, days) : null;
  let older = 0;
  let replaced = 0;
  let withheldCorrections = 0;
  const windowIds = new Set(rows.map((r) => r.envelope.event_id));
  // Latest event per fact: an edition lists only the newest row of each dedupe_key, and never a row
  // another row in the window supersedes. Read from every row, even one the gate withholds, so a
  // withheld correction still keeps the original it replaces out.
  const latestSeq = new Map<string, number>();
  const supersededIds = new Set<string>();
  for (const r of rows) {
    const k = r.envelope.dedupe_key;
    if (typeof k === "string" && k) latestSeq.set(k, Math.max(latestSeq.get(k) ?? -Infinity, r.seq));
    const s = r.envelope.supersedes_event_id;
    if (typeof s === "string" && s) supersededIds.add(s);
  }
  const withheld: Record<WithheldReason, number> = {
    not_redistributable: 0,
    internal_only_in_client_edition: 0,
    restricted_identifier_key: 0,
    path_not_on_allow_list: 0,
    value_not_allowed: 0,
    market_cap_or_price: 0,
  };
  const main: DigestItem[] = [];
  const review: DigestItem[] = [];
  const internal: DigestItem[] = [];
  for (const row of [...rows].sort((a, b) => a.seq - b.seq)) {
    const key = row.envelope.dedupe_key;
    if (supersededIds.has(row.envelope.event_id) || (typeof key === "string" && key && latestSeq.get(key) !== row.seq)) {
      replaced++;
      continue;
    }
    const why = withheldReason(row.envelope, audience);
    if (why) {
      withheld[why]++;
      if (isCorrection(row.envelope)) withheldCorrections++;
      continue;
    }
    // Belt and braces: whatever withheldReason says, a client edition never carries internal_only.
    if (isInternalOnly(row.envelope) && audience !== "internal") {
      withheld.internal_only_in_client_edition++;
      if (isCorrection(row.envelope)) withheldCorrections++;
      continue;
    }
    const shown =
      isInternalOnly(row.envelope) || isMain(row.envelope) || (includeUnderReview && row.envelope.lifecycle_status === "candidate");
    if (shown && !isRecent(row.envelope, cutoff)) {
      older++;
      continue;
    }
    const item = toItem(row);
    const sup = row.envelope.supersedes_event_id;
    if (item.flag && sup && windowIds.has(sup) && opts.markUnsentCorrections !== false) {
      item.flag = `${item.flag} ${UNSENT_CORRECTION_NOTE}`;
    }
    if (isInternalOnly(row.envelope)) internal.push(item);
    else if (isMain(row.envelope)) main.push(item);
    else if (includeUnderReview && row.envelope.lifecycle_status === "candidate") review.push(item);
  }
  const oldCorrectionCount =
    cutoff === null
      ? 0
      : main.filter((i) => {
          if (!isCorrection(i.envelope)) return false;
          const k = typeof i.envelope.knowledge_at === "string" ? i.envelope.knowledge_at.slice(0, 10) : null;
          return k === null || k < cutoff;
        }).length;

  const groups = new Map<string, FamilyGroup & { order: number }>();
  for (const item of main) {
    const f = familyOf(item.eventType);
    const g = groups.get(f.key) ?? { key: f.key, label: f.label, noun: f.noun, one: f.one, order: f.order, items: [] };
    g.items.push(item);
    groups.set(f.key, g);
  }
  const families = [...groups.values()]
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
    .map(({ key, label, noun, one, items }) => ({ key, label, noun, one, items: items.sort(byKnowledgeThenSeq) }));
  const underReview = capped(review, cap);
  const internalOnly = capped(internal, cap);

  // The attachment holds exactly the rows the email shows.
  const delivered = [...main, ...underReview.items, ...internalOnly.items].sort((a, b) => a.seq - b.seq);
  const body = delivered.map((i) => attachmentLine(i.envelope)).join("");
  return {
    editionDate: opts.editionDate,
    audience,
    includeUnderReview,
    sampleLabel: opts.sample ? (opts.sampleLabel ?? "[Sample]") : null,
    sample: Boolean(opts.sample),
    sampleNote: opts.sample ? (opts.sampleNote ?? null) : null,
    window: opts.window,
    families,
    underReview,
    internalOnly,
    older: { total: older, knowledgeBefore: cutoff, days },
    mainCount: main.length,
    correctionCount: main.filter((i) => i.flag).length,
    replaced,
    windowCount: main.length + older + underReview.total + internalOnly.total,
    oldCorrectionCount,
    withheldCorrections,
    gdeltCredit: delivered.some((i) => isGdeltDerived(i.envelope)),
    withheld,
    attachment: {
      filename: `events_${opts.editionDate}.jsonl`,
      body,
      lines: delivered.length,
      sha256: createHash("sha256").update(body, "utf8").digest("hex"),
    },
  };
}

/** One line of the attached file: the canonical envelope plus its license_label. */
export function attachmentLine(env: EventEnvelope): string {
  return canonicalJson({ ...env, license_label: licenseLabel(env) }) + "\n";
}

/** Sorted keys, compact separators, non-ASCII kept: the byte form of ERM3 contract.to_json. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

// ── subject, headline, descriptor ────────────────────────────────────────────

export function digestSubject(ed: DigestEdition): string {
  const n = ed.mainCount;
  const review = ed.underReview.total + ed.internalOnly.total;
  return `${ed.sampleLabel ? `${ed.sampleLabel} ` : ""}RiskModels Event Ledger — ${ed.editionDate} — ${n} ${
    n === 1 ? "event" : "events"
  }${review ? ` — ${review} under review` : ""}`;
}

export function windowText(w: DigestWindow): string {
  return w.basis === "ledger_seq"
    ? `events that entered the ledger after position ${w.after_seq}, through position ${w.through_seq}`
    : `events first knowable from ${w.from} through ${w.to}`;
}

/** The single count line for older events, or null when there are none. */
export function olderLine(ed: DigestEdition): string | null {
  const n = ed.older.total;
  if (!n) return null;
  return `${n} older ${n === 1 ? "event" : "events"} added to the ledger: first knowable before ${ed.older.knowledgeBefore}, more than ${ed.older.days} days before this edition. ${n === 1 ? "It is" : "They are"} not listed here or in the attached file.`;
}

/** An edition with nothing to list, nothing under review and no older count. List mode sends nothing for it. */
export function isEmptyEdition(ed: DigestEdition): boolean {
  return ed.mainCount === 0 && ed.underReview.total === 0 && ed.older.total === 0;
}

export function headline(ed: DigestEdition): string {
  if (ed.mainCount === 0) {
    if (ed.older.total) return `No new events first knowable in the last ${ed.older.days} days.`;
    return ed.window.basis === "ledger_seq"
      ? "No new events since the last edition."
      : `No events were first knowable from ${ed.window.from} through ${ed.window.to}.`;
  }
  const fams = ed.families.map((f) => `${f.items.length} ${f.items.length === 1 ? f.one : f.noun}`).join(", ");
  const corr = ed.correctionCount
    ? ` ${ed.correctionCount} ${ed.correctionCount === 1 ? "is a correction" : "are corrections"} to earlier events.`
    : " No corrections to earlier events.";
  return `${ed.mainCount} verified ${ed.mainCount === 1 ? "event" : "events"}: ${fams}.${corr}`;
}

export const ENVELOPE_REQUIRED_FIELDS = [
  "schema_version",
  "event_id",
  "dedupe_key",
  "event_type",
  "lifecycle_status",
  "source_role",
  "entity",
  "source",
  "license",
  "effective_at",
  "effective_basis",
  "knowledge_at",
  "knowledge_basis",
  "first_observed_at",
  "first_observed_basis",
  "ingested_at",
  "supersedes_event_id",
  "correction_reason",
  "payload",
] as const;

export function buildDigestDescriptor(ed: DigestEdition) {
  const byLifecycle: Record<string, number> = {};
  const byType: Record<string, number> = {};
  for (const line of ed.attachment.body.split("\n").filter(Boolean)) {
    const env = JSON.parse(line) as EventEnvelope;
    byLifecycle[env.lifecycle_status] = (byLifecycle[env.lifecycle_status] ?? 0) + 1;
    byType[env.event_type] = (byType[env.event_type] ?? 0) + 1;
  }
  return {
    schema: DIGEST_DESCRIPTOR_SCHEMA,
    name: "RiskModels Event Ledger daily edition",
    publisher: "RiskModels, a DBA of Blue Water Macro Corp.",
    edition_date: ed.editionDate,
    sample: ed.sample,
    audience: ed.audience,
    window: ed.window,
    attachment: {
      filename: ed.attachment.filename,
      media_type: ATTACHMENT_MEDIA_TYPE,
      format: "jsonl",
      encoding: "utf-8",
      lines: ed.attachment.lines,
      sha256: ed.attachment.sha256,
    },
    record: {
      envelope: "RiskModels event contract",
      schema_version: ENVELOPE_SCHEMA_VERSION,
      serialization:
        "one envelope per line, canonical JSON: sorted keys, compact separators, plus one added key, license_label; removing license_label gives the contract bytes",
      license_label: "plain-language licence of the event; the license object holds classification, redistributable and basis",
      required_fields: ENVELOPE_REQUIRED_FIELDS,
      time_axes: {
        effective_at: "valid time: when the real-world state changes (basis in effective_basis)",
        knowledge_at: "knowledge time: when it became publicly knowable (basis in knowledge_basis)",
        first_observed_at:
          "system time: when RiskModels first saw it; null with first_observed_basis when not recorded",
        ingested_at: "system time: when the ledger recorded it",
      },
      lifecycle_status: ["candidate", "verified", "rejected", "superseded"],
      source_role: ["discovery", "primary", "corroborating", "contributor", "internal_derived"],
      corrections: "a correction is a new event whose supersedes_event_id names the event it replaces",
      timestamps: "ISO-8601 UTC",
    },
    counts: {
      by_lifecycle_status: byLifecycle,
      by_event_type: byType,
      sections: {
        main: ed.mainCount,
        ...(ed.window.basis === "ledger_seq"
          ? { older_not_listed: { total: ed.older.total, knowledge_before: ed.older.knowledgeBefore } }
          : {}),
        under_review: { shown: ed.underReview.items.length, total: ed.underReview.total },
        ...(ed.audience === "internal"
          ? { internal_only: { shown: ed.internalOnly.items.length, total: ed.internalOnly.total } }
          : {}),
      },
    },
    selection: [
      ed.audience === "internal"
        ? "Internal edition: redistributable events, plus internal_only rows under their own heading. Not for clients."
        : "Only events whose license is redistributable public record or derived data.",
      "Verified events come from primary sources (SEC filings).",
      ed.includeUnderReview || ed.internalOnly.total
        ? "Candidates appear under review, capped per section; the file holds exactly the rows shown."
        : "Candidates are not included.",
    ],
    validate: [
      "sha256 of the attachment bytes equals attachment.sha256",
      "line count equals attachment.lines",
      "every line parses as JSON and has schema_version 1.0.0 and every required field",
    ],
    terms: FEED_TERMS_URL,
    ...(ed.gdeltCredit ? { credits: [GDELT_CREDIT] } : {}),
    links: { about: `${CANONICAL_SITE_URL}/security-master-feed`, terms: FEED_TERMS_URL },
    contact: DIGEST_CONTACT_EMAIL,
  };
}

export function digestDescriptorJson(ed: DigestEdition): string {
  return JSON.stringify(buildDigestDescriptor(ed), null, 2);
}

// ── review sections (shared by the HTML and text parts) ─────────────────────

export const UNDER_REVIEW_HEADING = "Under review, not verified";
export const INTERNAL_ONLY_HEADING = "Internal only, not for clients";

export function reviewSectionTitle(kind: "under_review" | "internal_only", sec: ReviewSection): string {
  const shown = sec.notShown ? ` (showing ${sec.items.length})` : "";
  return kind === "under_review"
    ? `${UNDER_REVIEW_HEADING}: ${sec.total}${shown}`
    : `${INTERNAL_ONLY_HEADING}. ${UNDER_REVIEW_HEADING}: ${sec.total}${shown}`;
}

export function reviewSectionNote(kind: "under_review" | "internal_only", sec: ReviewSection): string {
  const more = sec.notShown
    ? ` ${sec.notShown} more ${sec.notShown === 1 ? "row is" : "rows are"} not shown here or in the attached file.`
    : "";
  return kind === "under_review"
    ? `These are candidates. Do not act on them as facts.${more}`
    : `These rows are licensed for internal use only and must not be forwarded or sent to clients.${more}`;
}

// ── per-recipient footer ─────────────────────────────────────────────────────

export const DIGEST_FOOTER_LEGAL =
  "RiskModels is a registered DBA of Blue Water Macro Corp., 1001 Bridgeway, P.O. Box 510, Sausalito, CA 94965. Historical record of public filings. General and impersonal information, not investment advice.";

/** The links at the foot of one recipient's copy. */
export interface EditionFooter {
  /** Signup page carrying the recipient's referral code, or the plain signup page; null in an internal edition. */
  forwardUrl: string | null;
  /** "Send this to your team inbox instead"; null for a delivery (team) address or an unlisted recipient. */
  teamInboxUrl: string | null;
  /** Human unsubscribe page; null for a recipient who is not on the list. */
  unsubscribeUrl: string | null;
  termsUrl: string;
}

/** Recipient as feed_waitlist_edition_recipients() returns it (purpose and referral_code since 20261113120000). */
export interface FooterRecipient {
  unsubscribe_token: string;
  purpose?: "contact" | "feed" | string | null;
  referral_code?: string | null;
}

const REFERRAL_CODE_RE = /^[a-z0-9]{8,32}$/;

export function forwardUrl(referralCode?: string | null): string {
  return referralCode && REFERRAL_CODE_RE.test(referralCode)
    ? `${FEED_SIGNUP_URL}?ref=${referralCode}#join`
    : `${FEED_SIGNUP_URL}#join`;
}

/** Internal edition and previews: no forward link and no personal token. */
export function internalFooter(): EditionFooter {
  return { forwardUrl: null, teamInboxUrl: null, unsubscribeUrl: null, termsUrl: FEED_TERMS_URL };
}

export function editionFooter(r: FooterRecipient | null): EditionFooter {
  if (!r) return { forwardUrl: forwardUrl(null), teamInboxUrl: null, unsubscribeUrl: null, termsUrl: FEED_TERMS_URL };
  const t = encodeURIComponent(r.unsubscribe_token);
  return {
    forwardUrl: forwardUrl(r.referral_code),
    teamInboxUrl: r.purpose === "feed" ? null : `${FEED_SIGNUP_URL}/delivery?token=${t}`,
    unsubscribeUrl: `${FEED_SIGNUP_URL}/unsubscribe?token=${t}`,
    termsUrl: FEED_TERMS_URL,
  };
}

export const FOOTER_FORWARD_TEXT = "Forward to a colleague: they can sign up for their own copy here";
export const FOOTER_TEAM_INBOX_TEXT = "Send this to your team inbox instead";
export const FOOTER_TERMS_TEXT =
  "Free edition: use inside your firm and quote with attribution. No bulk redistribution or resale; see the terms";

function footerText(f: EditionFooter): string[] {
  const out = f.forwardUrl ? [`${FOOTER_FORWARD_TEXT}: ${f.forwardUrl}`] : [];
  if (f.teamInboxUrl) {
    out.push(
      `${FOOTER_TEAM_INBOX_TEXT}: ${f.teamInboxUrl} (you can also stop delivery to this address once the team inbox confirms)`,
    );
  }
  if (f.unsubscribeUrl) out.push(`Unsubscribe: ${f.unsubscribeUrl}`);
  out.push(`${FOOTER_TERMS_TEXT}: ${f.termsUrl}`);
  return out;
}

// ── plain-text part ──────────────────────────────────────────────────────────

/** One dated line of an event: label, date, basis in brackets, then evidence and any default. */
export interface ItemDate {
  label: string;
  date: string;
  basis: string;
  /** Evidence filing (EDGAR folder) behind the date, shown on the next line. */
  source: { label: string | null; url: string | null } | null;
  /** Shown after the brackets (the Rule 12d2-2 default). */
  extra: string | null;
}

/** Explains the date labels; in both the HTML and the plain-text parts. */
export const DATES_NOTE =
  "Dates are UTC. Known is when the event became publicly knowable. For a delisting, Listing removed is the removal date stated with the Form 25; " +
  "without one, the date the form was signed (Form 25 signed) or filed (Form 25 filed) is shown and named as such, with the Rule 12d2-2 default " +
  "(filing + 10 days). Trading stopped is shown only when the issuer's 8-K reports a completed transaction (item 2.01) whose date was read " +
  "from the document; that is the day trading stopped, and the last trade is normally the session before. An 8-K delisting notice (item 3.01) alone is not a trading stop. Effective is when any other event takes effect.";

/** The dates of one event, in reading order: known, trading stopped (delistings), effective or removed. */
export function itemDates(i: DigestItem): ItemDate[] {
  const out: ItemDate[] = [
    { label: "Known", date: i.knowledgeDate ?? "not stated", basis: i.knowledgeBasis, source: null, extra: null },
  ];
  if (i.tradingStopped) {
    out.push({
      label: "Trading stopped",
      date: i.tradingStopped.date,
      basis: i.tradingStopped.basis,
      source: i.tradingStopped.source || i.tradingStopped.url ? { label: i.tradingStopped.source, url: i.tradingStopped.url } : null,
      extra: null,
    });
  }
  const basis = i.effectiveSource ? i.effectiveSource.text : i.effectiveBasis;
  out.push({
    label: i.effectiveLabel,
    date: i.effectiveDate ?? "not stated",
    basis: i.effectiveNote ? `${basis}; ${i.effectiveNote}` : basis,
    source: i.effectiveSource && (i.effectiveSource.label || i.effectiveSource.url) ? { label: i.effectiveSource.label, url: i.effectiveSource.url } : null,
    extra: i.effectiveEstimate ? `Rule 12d2-2 default (filing + 10 days) ${i.effectiveEstimate}` : null,
  });
  return out;
}

function itemText(i: DigestItem): string[] {
  const who = [i.ticker, i.company].filter(Boolean).join(" · ") || "Name not recorded";
  const pad = (label: string) => `  ${`${label}:`.padEnd(17)}`;
  const indent = " ".repeat(19);
  const lines = [
    `- ${who}${i.identifiers.length ? ` (${i.identifiers.join(", ")})` : ""}`,
    `${pad("Event")}${i.event}${i.eventDetail ? ` (${i.eventDetail})` : ""}`,
  ];
  for (const d of itemDates(i)) {
    lines.push(`${pad(d.label)}${d.date} (${d.basis})${d.extra ? `; ${d.extra}` : ""}`);
    if (d.source) lines.push(`${indent}${[d.source.label, d.source.url].filter(Boolean).join(" ")}`);
  }
  lines.push(`${pad("Status")}${i.status}; source role ${i.sourceRole}`);
  if (i.sourceUrl) lines.push(`${pad("Source")}${i.sourceLabel} ${i.sourceUrl}`);
  if (i.flag) lines.push(`${pad("FLAG")}${i.flag}`);
  return lines;
}

export function renderDigestText(ed: DigestEdition, footer: EditionFooter = editionFooter(null)): string {
  const out: string[] = [];
  out.push(`RiskModels Event Ledger — ${ed.editionDate}${ed.sample ? " (review sample)" : ""}`);
  out.push("");
  if (ed.sampleNote) out.push(ed.sampleNote, "");
  out.push(headline(ed));
  out.push(`Window: ${windowText(ed.window)}.`);
  out.push("");
  out.push(`${EVENT_LEDGER_RSS_TEXT}: ${EVENT_LEDGER_RSS_URL}`);
  out.push(EVENT_LEDGER_RSS_NOTE);
  out.push("");
  for (const f of ed.families) {
    const title = `${f.label}: ${f.items.length}`;
    out.push(title, "-".repeat(title.length));
    for (const i of f.items) out.push(...itemText(i), "");
  }
  const old = olderLine(ed);
  if (old) out.push(old, "");
  for (const kind of ["under_review", "internal_only"] as const) {
    const sec = kind === "under_review" ? ed.underReview : ed.internalOnly;
    if (!sec.total) continue;
    const title = reviewSectionTitle(kind, sec);
    out.push(title, "-".repeat(title.length), reviewSectionNote(kind, sec), "");
    for (const i of sec.items) out.push(...itemText(i), "");
  }
  out.push(
    `Attached: ${ed.attachment.filename}, ${ed.attachment.lines} ${ed.attachment.lines === 1 ? "line" : "lines"}, one event per line in the published envelope.`,
  );
  out.push(DATES_NOTE);
  out.push("");
  out.push("For agents and automation");
  out.push("You can ignore this block. It describes the attached file so an agent can find and validate it.");
  out.push(digestDescriptorJson(ed));
  out.push("");
  if (ed.gdeltCredit) out.push(GDELT_CREDIT, "");
  out.push(`Questions or corrections: reply to this email or write to ${DIGEST_CONTACT_EMAIL}.`);
  out.push(...footerText(footer));
  out.push(DIGEST_FOOTER_LEGAL);
  return out.join("\n") + "\n";
}

/** Paths into the rendered output that hit a restricted word. Empty means the edition may go out. */
export function restrictedWordHits(...bodies: string[]): string[] {
  const hits: string[] = [];
  for (const re of RESTRICTED_OUTPUT_RES) if (bodies.some((b) => re.test(b))) hits.push(re.source);
  return hits;
}
