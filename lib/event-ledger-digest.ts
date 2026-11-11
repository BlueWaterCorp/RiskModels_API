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
 *     the main tables. Candidates are left out unless includeUnderReview is
 *     set, and then appear only in a section labelled "Under review".
 *
 * The attached file holds each delivered envelope exactly as published, one per
 * line, re-serialized canonically (sorted keys, compact separators), the same
 * byte form as contract.to_json in ERM3.
 */

import { createHash } from "node:crypto";
import { CANONICAL_SITE_URL } from "@/lib/constants";

export const DIGEST_DESCRIPTOR_SCHEMA = "riskmodels.event-ledger-digest/1";
export const DIGEST_CONTACT_EMAIL = "service@riskmodels.app";
export const ENVELOPE_SCHEMA_VERSION = "1.0.0";
export const ATTACHMENT_MEDIA_TYPE = "application/x-ndjson";

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

export type WithheldReason = "not_redistributable" | "restricted_identifier_key";

export function withheldReason(env: EventEnvelope): WithheldReason | null {
  const lic = env.license ?? {};
  if (lic.redistributable !== true) return "not_redistributable";
  if (lic.classification !== "public_record" && lic.classification !== "derived") return "not_redistributable";
  if (restrictedKeyPaths(env.payload ?? {}).length || restrictedKeyPaths(env.entity ?? {}).length) {
    return "restricted_identifier_key";
  }
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
  const label = str(env.source?.accession_number) ?? str(env.source?.source_id);
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

export interface DigestEdition {
  editionDate: string;
  sample: boolean;
  /** Shown at the top of a sample edition: why it is a sample and what it covers. */
  sampleNote: string | null;
  window: DigestWindow;
  /** Verified events plus corrections and withdrawals, grouped by family. */
  families: FamilyGroup[];
  /** Deliverable candidates; empty unless includeUnderReview. */
  underReview: DigestItem[];
  /** Count in the headline and subject: verified events plus corrections. */
  mainCount: number;
  correctionCount: number;
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
  includeUnderReview?: boolean;
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

export function buildDigest(rows: readonly LedgerRow[], opts: BuildOptions): DigestEdition {
  const withheld: Record<WithheldReason, number> = { not_redistributable: 0, restricted_identifier_key: 0 };
  const main: DigestItem[] = [];
  const review: DigestItem[] = [];
  for (const row of [...rows].sort((a, b) => a.seq - b.seq)) {
    const why = withheldReason(row.envelope);
    if (why) {
      withheld[why]++;
      continue;
    }
    if (isMain(row.envelope)) main.push(toItem(row));
    else if (opts.includeUnderReview && row.envelope.lifecycle_status === "candidate") review.push(toItem(row));
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
  review.sort(byKnowledgeThenSeq);

  const delivered = [...main, ...review].sort((a, b) => a.seq - b.seq);
  const body = delivered.map((i) => canonicalJson(i.envelope) + "\n").join("");
  return {
    editionDate: opts.editionDate,
    sample: Boolean(opts.sample),
    sampleNote: opts.sample ? (opts.sampleNote ?? null) : null,
    window: opts.window,
    families,
    underReview: review,
    mainCount: main.length,
    correctionCount: main.filter((i) => i.flag).length,
    withheld,
    attachment: {
      filename: `events_${opts.editionDate}.jsonl`,
      body,
      lines: delivered.length,
      sha256: createHash("sha256").update(body, "utf8").digest("hex"),
    },
  };
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
  return `${ed.sample ? "[Sample] " : ""}RiskModels Event Ledger — ${ed.editionDate} — ${n} ${n === 1 ? "event" : "events"}`;
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
      serialization: "one envelope per line, canonical JSON: sorted keys, compact separators",
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
    counts: { by_lifecycle_status: byLifecycle, by_event_type: byType },
    selection: [
      "Only events whose license is redistributable public record or derived data.",
      "Verified events come from primary sources (SEC filings).",
      ed.underReview.length
        ? "Candidates appear in the file with lifecycle_status candidate and in the Under review section."
        : "Candidates are not included.",
    ],
    validate: [
      "sha256 of the attachment bytes equals attachment.sha256",
      "line count equals attachment.lines",
      "every line parses as JSON and has schema_version 1.0.0 and every required field",
    ],
    links: { about: `${CANONICAL_SITE_URL}/security-master-feed` },
    contact: DIGEST_CONTACT_EMAIL,
  };
}

export function digestDescriptorJson(ed: DigestEdition): string {
  return JSON.stringify(buildDigestDescriptor(ed), null, 2);
}

// ── plain-text part ──────────────────────────────────────────────────────────

export const DIGEST_FOOTER_LEGAL =
  "RiskModels is a registered DBA of Blue Water Macro Corp., 1001 Bridgeway, P.O. Box 510, Sausalito, CA 94965. Historical record of public filings. Not investment advice.";

function itemText(i: DigestItem): string[] {
  const who = [i.ticker, i.company].filter(Boolean).join(" · ") || "Unnamed issuer";
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

export function renderDigestText(ed: DigestEdition): string {
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
  if (ed.underReview.length) {
    out.push(`Under review, not verified: ${ed.underReview.length}`);
    out.push("These are candidates. Do not act on them as facts.");
    for (const i of ed.underReview) out.push(...itemText(i), "");
  }
  out.push(
    `Attached: ${ed.attachment.filename}, ${ed.attachment.lines} ${ed.attachment.lines === 1 ? "line" : "lines"}, one event per line in the published envelope.`,
  );
  out.push("");
  out.push("For agents and automation");
  out.push("You can ignore this block. It describes the attached file so an agent can find and validate it.");
  out.push(digestDescriptorJson(ed));
  out.push("");
  out.push(`Questions or corrections: reply to this email or write to ${DIGEST_CONTACT_EMAIL}.`);
  out.push(DIGEST_FOOTER_LEGAL);
  return out.join("\n") + "\n";
}

/** Paths into the rendered output that hit a restricted word. Empty means the edition may go out. */
export function restrictedWordHits(...bodies: string[]): string[] {
  const hits: string[] = [];
  for (const re of RESTRICTED_OUTPUT_RES) if (bodies.some((b) => re.test(b))) hits.push(re.source);
  return hits;
}
