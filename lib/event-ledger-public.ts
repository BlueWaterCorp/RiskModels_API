/**
 * Event Ledger export files, built from one read of the ledger:
 *
 * - buildPublicLatest: the subscriber export, the newest events. It is served only to an
 *   approved subscriber's private feed credential (app/security-master-feed/private).
 * - buildPublicSample: the public sample for riskmodels.org/events (RM_ORG app/events) and
 *   /security-master-feed/latest.json. A few events, none newer than a stated date.
 *
 * Both use the same gate, corrections and event ids; the sample only selects fewer, older rows.
 *
 * public.event_ledger is service-role only, so there is no public read path to
 * it. Instead the digest script writes this small static JSON
 * (scripts/event-ledger-digest.ts --public-json <path>) and RM_ORG renders it.
 *
 * Same gate as a client edition, nothing looser: buildDigest(audience
 * "client") decides what is deliverable (redistributable public_record or
 * derived only; internal_only rows, restricted identifier keys, paths off the
 * client allow-list, exact market cap values and prices withheld). Candidates
 * are never listed.
 *
 * Corrections. An event that a later event supersedes (supersedes_event_id), or
 * whose status is superseded, is dropped: a superseded original is never shown.
 * buildDigest also keeps only the newest row of each dedupe_key.
 * The correction, or a withdrawal, is listed with its flag. The supersession is
 * read from every input row, even one the gate withholds, so a withheld
 * correction still removes the original it replaces.
 *
 * The caller runs restrictedWordHits() and priceOrCapHits() on the serialized
 * file before writing it.
 */

import {
  FEED_SIGNUP_URL,
  FEED_TERMS_URL,
  GDELT_CREDIT,
  buildDigest,
  familyOf,
  licenseLabel,
  type DigestItem,
  type LedgerRow,
} from "@/lib/event-ledger-digest";

export const PUBLIC_LATEST_SCHEMA = "riskmodels.event-ledger-latest/1";
export const PUBLIC_LATEST_COUNT = 20;
/** Events in a subscriber's private export. */
export const SUBSCRIBER_LATEST_COUNT = PUBLIC_LATEST_COUNT;
/** Events in the public sample, and how many days it trails the ledger. */
export const PUBLIC_SAMPLE_COUNT = 5;
export const PUBLIC_SAMPLE_LAG_DAYS = 7;

export interface PublicLatestEvent {
  event_id: string;
  event_type: string;
  family: string;
  ticker: string | null;
  company: string | null;
  identifiers: string[];
  event: string;
  detail: string | null;
  effective_date: string | null;
  // TODO(RM_ORG app/events): the email now names a delisting's date by its basis ("Listing removed",
  // "Form 25 signed", "Form 25 filed") and shows the 8-K item 2.01 trading stop. Adding those keys
  // (effective_label, trading_stopped) here needs the paired RM_ORG change to its strict check of this
  // file first; until then the shape is unchanged.
  effective_basis: string;
  known_date: string | null;
  known_basis: string;
  source_url: string | null;
  source_label: string | null;
  license_label: string;
  /** lifecycle_status: verified, or rejected for a withdrawal. */
  status: string;
  /** "Correction of event ...", "Withdrawn: ..."; null for an ordinary event. */
  flag: string | null;
}

export interface PublicLatestFile {
  schema: typeof PUBLIC_LATEST_SCHEMA;
  generated_at: string;
  description: string;
  selection: string;
  count: number;
  latest_known_date: string | null;
  terms: string;
  signup: string;
  credits: string[];
  events: PublicLatestEvent[];
}

/** The public sample: the same shape, plus the fields that say it is a dated sample. */
export interface PublicSampleFile extends PublicLatestFile {
  sample: true;
  /** No event in the file became publicly known after this date (YYYY-MM-DD). */
  sample_through: string;
  sample_note: string;
  /** Where to request free subscriber access to the current feed. */
  access: string;
}

function toPublic(i: DigestItem): PublicLatestEvent {
  return {
    event_id: i.eventId,
    event_type: i.eventType,
    family: familyOf(i.eventType).label,
    ticker: i.ticker,
    company: i.company,
    identifiers: i.identifiers,
    event: i.event,
    detail: i.eventDetail,
    effective_date: i.effectiveDate,
    effective_basis: i.effectiveBasis,
    known_date: i.knowledgeDate,
    known_basis: i.knowledgeBasis,
    source_url: i.sourceUrl,
    source_label: i.sourceLabel,
    license_label: licenseLabel(i.envelope),
    status: i.status,
    flag: i.flag,
  };
}

/** Every client-deliverable event, newest first by knowledge time (ties: ledger seq), superseded originals dropped. */
function deliverable(rows: readonly LedgerRow[], generatedAt: string): { items: DigestItem[]; gdeltCredit: boolean } {
  const ed = buildDigest(rows, {
    editionDate: generatedAt.slice(0, 10),
    window: { basis: "ledger_seq", after_seq: 0, through_seq: 0 },
    audience: "client",
    includeUnderReview: false,
    recentDays: null,
    markUnsentCorrections: false,
  });
  const superseded = new Set(
    rows.map((r) => r.envelope.supersedes_event_id).filter((id): id is string => typeof id === "string" && id !== ""),
  );
  const items = ed.families
    .flatMap((f) => f.items)
    .filter((i) => !superseded.has(i.eventId) && i.status !== "superseded")
    .filter((i) => i.status === "verified" || (i.status === "rejected" && i.flag !== null))
    .sort((a, b) => {
      const ka = a.envelope.knowledge_at ?? "";
      const kb = b.envelope.knowledge_at ?? "";
      return ka < kb ? 1 : ka > kb ? -1 : b.seq - a.seq;
    });
  return { items, gdeltCredit: Boolean(ed.gdeltCredit) };
}

/** The newest `count` deliverable events. */
export function buildPublicLatest(
  rows: readonly LedgerRow[],
  opts: { generatedAt: string; count?: number },
): PublicLatestFile {
  const all = deliverable(rows, opts.generatedAt);
  return fileOf(all.items.slice(0, opts.count ?? PUBLIC_LATEST_COUNT), all.gdeltCredit, opts.generatedAt);
}

/** YYYY-MM-DD, `days` before the UTC date of `iso`. */
export function sampleCutoff(iso: string, days: number = PUBLIC_SAMPLE_LAG_DAYS): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * The public sample: the newest `count` deliverable events that became publicly known on or
 * before the cutoff. An event with no known date is left out, because it cannot be shown to
 * be older than the cutoff. Supersession is read from every row, so an event withdrawn or
 * corrected after the cutoff is still dropped from the sample.
 */
export function buildPublicSample(
  rows: readonly LedgerRow[],
  opts: { generatedAt: string; count?: number; lagDays?: number },
): PublicSampleFile {
  const all = deliverable(rows, opts.generatedAt);
  const through = sampleCutoff(opts.generatedAt, opts.lagDays ?? PUBLIC_SAMPLE_LAG_DAYS);
  const items = all.items
    .filter((i) => typeof i.knowledgeDate === "string" && i.knowledgeDate !== "" && i.knowledgeDate <= through)
    .slice(0, opts.count ?? PUBLIC_SAMPLE_COUNT);
  return {
    ...fileOf(items, all.gdeltCredit, opts.generatedAt),
    description:
      "A dated public sample of the RiskModels Event Ledger: US equity identity and listing-status events, each tied to the SEC filing behind it. The current feed is free for approved subscribers.",
    sample: true,
    sample_through: through,
    sample_note: `Sample only. It holds at most ${opts.count ?? PUBLIC_SAMPLE_COUNT} events, none publicly known after ${through}. Approved subscribers receive current events by email and private RSS.`,
    access: FEED_SIGNUP_URL,
  };
}

function fileOf(verified: DigestItem[], gdeltCredit: boolean, generatedAt: string): PublicLatestFile {
  return {
    schema: PUBLIC_LATEST_SCHEMA,
    generated_at: generatedAt,
    description:
      "The latest verified events in the RiskModels Event Ledger: US equity identity and listing-status events, each tied to the SEC filing behind it.",
    selection:
      "Verified events whose licence is redistributable public record or derived data, newest first by the time they became publicly knowable. Corrections and withdrawals are flagged, and an event they replace is left out. Candidates and internal rows are left out, as is any event with a field outside the published allow-list or carrying a licensed market value such as a price. Ticker and company name, when present, are derived by RiskModels from its security master.",
    count: verified.length,
    latest_known_date: verified[0]?.knowledgeDate ?? null,
    terms: FEED_TERMS_URL,
    signup: FEED_SIGNUP_URL,
    credits: gdeltCredit && verified.some((i) => /gdelt/i.test(JSON.stringify(i.envelope))) ? [GDELT_CREDIT] : [],
    events: verified.map(toPublic),
  };
}

/**
 * Queries the public file is built from. Verified events alone are not enough: a withdrawal
 * (rejected) or correction that supersedes an event must be read too, or the original it replaces
 * would be shown unflagged.
 */
export const PUBLIC_LATEST_QUERIES = [
  "envelope->>lifecycle_status=in.(verified,rejected,superseded)",
  "envelope->>supersedes_event_id=not.is.null",
] as const;

async function readRows(getRows: (query: string) => Promise<LedgerRow[]>): Promise<LedgerRow[]> {
  const bySeq = new Map<number, LedgerRow>();
  for (const q of PUBLIC_LATEST_QUERIES) for (const r of await getRows(q)) bySeq.set(r.seq, r);
  return [...bySeq.values()];
}

/** Fetches with `getRows` (one PostgREST filter per call), merges by seq, and builds the file. */
export async function loadPublicLatest(
  getRows: (query: string) => Promise<LedgerRow[]>,
  opts: { generatedAt: string; count?: number },
): Promise<PublicLatestFile> {
  return buildPublicLatest(await readRows(getRows), opts);
}

/** One read of the ledger, both files: the subscriber export and the public sample. */
export async function loadLedgerExports(
  getRows: (query: string) => Promise<LedgerRow[]>,
  opts: { generatedAt: string },
): Promise<{ subscriber: PublicLatestFile; sample: PublicSampleFile }> {
  const rows = await readRows(getRows);
  return {
    subscriber: buildPublicLatest(rows, { generatedAt: opts.generatedAt, count: SUBSCRIBER_LATEST_COUNT }),
    sample: buildPublicSample(rows, { generatedAt: opts.generatedAt }),
  };
}
