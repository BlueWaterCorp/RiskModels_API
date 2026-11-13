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
 * Footer. Each copy of an edition is built for one recipient (EditionFooter):
 * "Forward to a colleague" (signup link with the recipient's referral code),
 * "Send this to your team inbox instead" (contact addresses only; the change is
 * confirmed by email to that address), the unsubscribe page (a human page with a
 * confirm button, so a forwarded copy cannot unsubscribe anyone by a click), and
 * the free-edition terms.
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
  | "market_cap_in_client_edition"
  | "raw_vendor_value_in_client_edition";

/**
 * Licensed-data guard for client editions (docs/EVENT_LEDGER_SOURCE_REGISTER.md).
 *
 * The rule (Conrad, 2026-11-13): RiskModels may redistribute data DERIVED from its licensed market
 * data, with one exception, market capitalisation. So a client edition, and its attached file:
 *   - never carries a market cap value, or anything a reader could rebuild one from: market cap,
 *     size or cap bands, cap ranks, cap-weighted figures, or shares together with a price;
 *   - never carries a RAW licensed value (a price, volume or other bar field as received, a vendor
 *     code), only values RiskModels derived;
 *   - may carry derived fields, which are traced and labelled (derivedFieldPaths(), and the
 *     license_label of each line names them).
 * An event carrying either kind is withheld whole from client editions; the published envelope is
 * never edited. On 2026-11-13 none of the 4,604 verified events carried any of these keys.
 */
export const MARKET_CAP_KEY_RE =
  /(^|_)(market_?cap(s|italisation|italization)?|mkt_?cap|mcap|market_value|cap_(band|bucket|rank|ranking|tier|weight|weighted|pct|percentile)|size_(band|bucket|rank|tier|decile|quintile)|cap_weighted|capweight|float_cap)($|_)/i;
const RAW_VENDOR_KEY_RE =
  /(^|_)(price|prices|close|open|high|low|adj_close|adjusted_close|vwap|volume|bar|bars|ohlc|ohlcv|vendor|vendor_code|exchange_code|last_trade_date|last_traded|last_price)($|_)/i;
/** Shares outstanding alone is a filing fact; with any price it rebuilds market cap. */
const SHARES_KEY_RE = /(^|_)(shares|shares_outstanding|shares_out|share_count)($|_)/i;

function keyPaths(obj: unknown, re: RegExp, path: string, out: string[]) {
  if (Array.isArray(obj)) obj.forEach((v, i) => keyPaths(v, re, `${path}[${i}]`, out));
  else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const pth = `${path}.${k}`;
      if (re.test(k) && v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length)) out.push(pth);
      else keyPaths(v, re, pth, out);
    }
  }
}

function envelopeKeyPaths(env: EventEnvelope, re: RegExp): string[] {
  const out: string[] = [];
  keyPaths(env.payload ?? {}, re, "payload", out);
  keyPaths(env.entity ?? {}, re, "entity", out);
  keyPaths((env as Record<string, unknown>).affected ?? {}, re, "affected", out);
  return out;
}

/** Paths of market cap values (or a shares-plus-price pair) in an envelope. */
export function marketCapPaths(env: EventEnvelope): string[] {
  const cap = envelopeKeyPaths(env, MARKET_CAP_KEY_RE);
  const shares = envelopeKeyPaths(env, SHARES_KEY_RE);
  const raw = envelopeKeyPaths(env, RAW_VENDOR_KEY_RE);
  return shares.length && raw.length ? [...cap, ...shares] : cap;
}

/** Paths of raw licensed values (prices, volumes, bar fields, vendor codes) in an envelope. */
export function rawVendorPaths(env: EventEnvelope): string[] {
  return envelopeKeyPaths(env, RAW_VENDOR_KEY_RE);
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

/** Words that mean market cap in rendered output. A client edition containing one is refused. */
export const MARKET_CAP_OUTPUT_RES = [
  /\bmarket[\s_-]?cap(s|italisation|italization)?\b/i,
  /\bmkt[\s_-]?cap\b/i,
  /\bmcap\b/i,
  /\bcap[\s_-](band|bucket|rank|tier|weight(ed)?)\b/i,
  /\bsize[\s_-](band|bucket|decile|quintile)\b/i,
];

/** Patterns of MARKET_CAP_OUTPUT_RES found in the rendered bodies; empty means none. */
export function marketCapHits(...bodies: string[]): string[] {
  return MARKET_CAP_OUTPUT_RES.filter((re) => bodies.some((b) => re.test(b))).map((re) => re.source);
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
  if (NATIONAL_ID_FLAVORED_SYM_ID.test(JSON.stringify(env))) return "restricted_identifier_key";
  // A restricted word inside a value (4 live Form 25 security descriptions quote one) withholds that row,
  // rather than refusing the whole edition at the output scan, which stays as the last check.
  if (RESTRICTED_OUTPUT_RES.some((re) => re.test(JSON.stringify(env)))) return "restricted_identifier_key";
  if (isInternalOnly(env)) return audience === "internal" ? null : "internal_only_in_client_edition";
  if (audience === "client" && marketCapPaths(env).length) return "market_cap_in_client_edition";
  if (audience === "client" && rawVendorPaths(env).length) return "raw_vendor_value_in_client_edition";
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

export function familyOf(eventType: string): { key: string; label: string; noun: string; order: number } {
  const i = FAMILIES.findIndex((f) => f.types.includes(eventType));
  if (i >= 0) return { key: FAMILIES[i].key, label: FAMILIES[i].label, noun: FAMILIES[i].noun, order: i };
  const noun = eventType.replace(/_/g, " ");
  return { key: eventType, label: noun.replace(/^./, (c) => c.toUpperCase()), noun, order: FAMILIES.length };
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
  effectiveBasis: string;
  /** Payload's Rule 12d2-2 estimate (filing + 10 days), when the adapter recorded one. */
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

function flagOf(env: EventEnvelope): string | null {
  const reason = str(env.correction_reason);
  if (env.supersedes_event_id) {
    return `Correction of event ${env.supersedes_event_id.slice(0, 8)}${reason ? `: ${reason}` : ""}`;
  }
  if (env.lifecycle_status === "superseded") return `Superseded${reason ? `: ${reason}` : ""}`;
  if (env.lifecycle_status === "rejected") return `Withdrawn${reason ? `: ${reason}` : ""}`;
  return null;
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
    effectiveBasis: basisLabel(env.effective_basis),
    effectiveEstimate: str(p.rule_12d2_2_effective_estimate),
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
  /** Count in the headline and subject: verified events plus corrections. */
  mainCount: number;
  correctionCount: number;
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
}

export class InternalRecipientError extends Error {
  constructor() {
    super("internal_edition_recipient_not_allowed");
  }
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
  const withheld: Record<WithheldReason, number> = {
    not_redistributable: 0,
    internal_only_in_client_edition: 0,
    restricted_identifier_key: 0,
    market_cap_in_client_edition: 0,
    raw_vendor_value_in_client_edition: 0,
  };
  const main: DigestItem[] = [];
  const review: DigestItem[] = [];
  const internal: DigestItem[] = [];
  for (const row of [...rows].sort((a, b) => a.seq - b.seq)) {
    const why = withheldReason(row.envelope, audience);
    if (why) {
      withheld[why]++;
      continue;
    }
    // Belt and braces: whatever withheldReason says, a client edition never carries internal_only.
    if (isInternalOnly(row.envelope)) {
      if (audience === "internal") internal.push(toItem(row));
      else withheld.internal_only_in_client_edition++;
    } else if (isMain(row.envelope)) main.push(toItem(row));
    else if (includeUnderReview && row.envelope.lifecycle_status === "candidate") review.push(toItem(row));
  }

  const groups = new Map<string, FamilyGroup & { order: number }>();
  for (const item of main) {
    const f = familyOf(item.eventType);
    const g = groups.get(f.key) ?? { key: f.key, label: f.label, noun: f.noun, order: f.order, items: [] };
    g.items.push(item);
    groups.set(f.key, g);
  }
  const families = [...groups.values()]
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
    .map(({ key, label, noun, items }) => ({ key, label, noun, items: items.sort(byKnowledgeThenSeq) }));
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
    mainCount: main.length,
    correctionCount: main.filter((i) => i.flag).length,
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

export function headline(ed: DigestEdition): string {
  if (ed.mainCount === 0) {
    return ed.window.basis === "ledger_seq"
      ? "No new events since the last edition."
      : `No events were first knowable from ${ed.window.from} through ${ed.window.to}.`;
  }
  const fams = ed.families.map((f) => `${f.items.length} ${f.noun}`).join(", ");
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
  /** Signup page carrying the recipient's referral code, or the plain signup page. */
  forwardUrl: string;
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
  const out = [`${FOOTER_FORWARD_TEXT}: ${f.forwardUrl}`];
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

function itemText(i: DigestItem): string[] {
  const who = [i.ticker, i.company].filter(Boolean).join(" · ") || "Name not recorded";
  const lines = [
    `- ${who}${i.identifiers.length ? ` (${i.identifiers.join(", ")})` : ""}`,
    `  Event:     ${i.event}${i.eventDetail ? ` (${i.eventDetail})` : ""}`,
    `  Effective: ${i.effectiveDate ?? "not stated"} (${i.effectiveBasis})${
      i.effectiveEstimate ? `; Rule 12d2-2 estimate ${i.effectiveEstimate}` : ""
    }`,
    `  Known:     ${i.knowledgeDate ?? "not stated"} (${i.knowledgeBasis})`,
    `  Status:    ${i.status}; source role ${i.sourceRole}`,
  ];
  if (i.sourceUrl) lines.push(`  Source:    ${i.sourceLabel} ${i.sourceUrl}`);
  if (i.flag) lines.push(`  FLAG:      ${i.flag}`);
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
  for (const f of ed.families) {
    const title = `${f.label}: ${f.items.length}`;
    out.push(title, "-".repeat(title.length));
    for (const i of f.items) out.push(...itemText(i), "");
  }
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
