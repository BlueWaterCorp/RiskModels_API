/**
 * Public "latest events" file for riskmodels.org/events (RM_ORG app/events).
 *
 * public.event_ledger is service-role only, so there is no public read path to
 * it. Instead the digest script writes this small static JSON
 * (scripts/event-ledger-digest.ts --public-json <path>) and RM_ORG renders it.
 *
 * Same gate as a client edition, nothing looser: buildDigest(audience
 * "client") decides what is deliverable (redistributable public_record or
 * derived only; internal_only, restricted identifier keys and vendor-traceable
 * values withheld), and only VERIFIED events are listed here (no candidates,
 * no corrections-only rows). The caller runs restrictedWordHits() on the
 * serialized file before writing it.
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
  effective_basis: string;
  known_date: string | null;
  known_basis: string;
  source_url: string | null;
  source_label: string | null;
  license_label: string;
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
  };
}

/** The newest `count` verified, client-deliverable events by knowledge time (ties: ledger seq). */
export function buildPublicLatest(
  rows: readonly LedgerRow[],
  opts: { generatedAt: string; count?: number },
): PublicLatestFile {
  const count = opts.count ?? PUBLIC_LATEST_COUNT;
  const ed = buildDigest(rows, {
    editionDate: opts.generatedAt.slice(0, 10),
    window: { basis: "ledger_seq", after_seq: 0, through_seq: 0 },
    audience: "client",
    includeUnderReview: false,
  });
  const verified = ed.families
    .flatMap((f) => f.items)
    .filter((i) => i.status === "verified" && !i.flag)
    .sort((a, b) => {
      const ka = a.envelope.knowledge_at ?? "";
      const kb = b.envelope.knowledge_at ?? "";
      return ka < kb ? 1 : ka > kb ? -1 : b.seq - a.seq;
    })
    .slice(0, count);
  return {
    schema: PUBLIC_LATEST_SCHEMA,
    generated_at: opts.generatedAt,
    description:
      "The latest verified events in the RiskModels Event Ledger: US equity identity and listing-status events, each tied to the SEC filing behind it.",
    selection:
      "Verified events whose licence is redistributable public record or derived data, newest first by the time they became publicly knowable. Candidates, internal rows and anything traced to licensed data are left out.",
    count: verified.length,
    latest_known_date: verified[0]?.knowledgeDate ?? null,
    terms: FEED_TERMS_URL,
    signup: FEED_SIGNUP_URL,
    credits: ed.gdeltCredit && verified.some((i) => /gdelt/i.test(JSON.stringify(i.envelope))) ? [GDELT_CREDIT] : [],
    events: verified.map(toPublic),
  };
}
