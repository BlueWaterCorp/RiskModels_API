import { Body, Container, Head, Heading, Hr, Html, Link, Preview, Section, Text } from "@react-email/components";
import * as React from "react";
import { FeedHeader, FEED_LOGO_URL, styles as feedStyles } from "./feed-shared";
import {
  DIGEST_CONTACT_EMAIL,
  DIGEST_FOOTER_LEGAL,
  digestDescriptorJson,
  headline,
  windowText,
  type DigestEdition,
  type DigestItem,
} from "../lib/event-ledger-digest";

/**
 * Daily Event Ledger edition (HTML part). Written to the standard of a client
 * email; for now it goes to one internal recipient only (see
 * scripts/event-ledger-digest.ts). Every value comes from the edition built by
 * lib/event-ledger-digest.ts; the template adds no facts of its own.
 */

const NAVY = "#002a5e";
const TEAL = "#006f8e";

const s = {
  ...feedStyles,
  container: { ...feedStyles.container, maxWidth: "760px" },
  headline: { color: "#1f2937", fontSize: "16px", lineHeight: "1.5", margin: "0 0 6px", fontWeight: "600" },
  window: { color: "#64748b", fontSize: "13px", lineHeight: "1.5", margin: "0 0 20px" },
  familyHeading: {
    color: NAVY,
    fontSize: "15px",
    fontWeight: "600",
    margin: "22px 0 8px",
    borderBottom: `2px solid ${TEAL}`,
    paddingBottom: "4px",
  },
  reviewHeading: {
    color: "#92400e",
    fontSize: "15px",
    fontWeight: "600",
    margin: "22px 0 4px",
    borderBottom: "2px solid #d97706",
    paddingBottom: "4px",
  },
  table: { width: "100%", tableLayout: "fixed" as const, borderCollapse: "collapse" as const, fontSize: "12px", lineHeight: "1.45" },
  th: {
    textAlign: "left" as const,
    color: "#475569",
    fontWeight: "600",
    fontSize: "11px",
    padding: "6px 6px",
    borderBottom: "1px solid #cbd5e1",
  },
  td: { color: "#1f2937", padding: "7px 6px", wordBreak: "break-word" as const, borderBottom: "1px solid #e2e8f0", verticalAlign: "top" as const },
  sub: { color: "#64748b", fontSize: "11px" },
  verified: { color: "#166534", fontWeight: "600" },
  candidate: { color: "#92400e", fontWeight: "600" },
  flag: {
    display: "inline-block" as const,
    marginTop: "4px",
    backgroundColor: "#fff7ed",
    border: "1px solid #E07000",
    color: "#9a3412",
    fontSize: "11px",
    padding: "1px 6px",
    borderRadius: "3px",
  },
  empty: { ...feedStyles.banner, borderLeft: `3px solid ${TEAL}` },
};

const COLUMNS: ReadonlyArray<[string, string]> = [
  ["Effective", "13%"],
  ["Known", "12%"],
  ["Ticker / company", "18%"],
  ["Event", "29%"],
  ["Status", "8%"],
  ["Source role", "8%"],
  ["Source", "12%"],
];

const Row = ({ i }: { i: DigestItem }) => (
  <tr>
    <td style={s.td}>
      {i.effectiveDate ?? "not stated"}
      <br />
      <span style={s.sub}>{i.effectiveBasis}</span>
      {i.effectiveEstimate ? (
        <>
          <br />
          <span style={s.sub}>12d2-2 est. {i.effectiveEstimate}</span>
        </>
      ) : null}
    </td>
    <td style={s.td}>
      {i.knowledgeDate ?? "not stated"}
      <br />
      <span style={s.sub}>{i.knowledgeBasis}</span>
    </td>
    <td style={s.td}>
      {i.ticker ? <strong>{i.ticker} </strong> : null}
      {i.company ?? "Unnamed issuer"}
      {i.identifiers.length ? (
        <>
          <br />
          <span style={s.sub}>{i.identifiers.join(" · ")}</span>
        </>
      ) : null}
    </td>
    <td style={s.td}>
      {i.event}
      {i.eventDetail ? (
        <>
          <br />
          <span style={s.sub}>{i.eventDetail}</span>
        </>
      ) : null}
      {i.flag ? (
        <>
          <br />
          <span style={s.flag}>{i.flag}</span>
        </>
      ) : null}
    </td>
    <td style={{ ...s.td, ...(i.status === "verified" ? s.verified : s.candidate) }}>{i.status}</td>
    <td style={s.td}>{i.sourceRole}</td>
    <td style={s.td}>
      {i.sourceUrl ? (
        <Link href={i.sourceUrl} style={s.link}>
          {i.sourceLabel ?? "source"}
        </Link>
      ) : (
        <span style={s.sub}>{i.sourceLabel ?? "none"}</span>
      )}
    </td>
  </tr>
);

const EventTable = ({ items }: { items: DigestItem[] }) => (
  <table style={s.table} cellPadding={0} cellSpacing={0} role="presentation">
    <thead>
      <tr>
        {COLUMNS.map(([c, w]) => (
          <th key={c} style={{ ...s.th, width: w }}>
            {c}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {items.map((i) => (
        <Row key={i.eventId} i={i} />
      ))}
    </tbody>
  </table>
);

export interface EventLedgerDigestEmailProps {
  edition: DigestEdition;
  logoSrc?: string;
}

export const EventLedgerDigestEmail = ({ edition, logoSrc = FEED_LOGO_URL }: EventLedgerDigestEmailProps) => (
  <Html>
    <Head />
    <Preview>{headline(edition)}</Preview>
    <Body style={s.main}>
      <Container style={s.container}>
        <FeedHeader logoSrc={logoSrc} />
        <Heading style={s.heading}>
          Event Ledger — {edition.editionDate}
          {edition.sample ? " (review sample)" : ""}
        </Heading>

        {edition.sampleNote ? <Text style={s.banner}>{edition.sampleNote}</Text> : null}

        <Text style={s.headline}>{headline(edition)}</Text>
        <Text style={s.window}>Window: {windowText(edition.window)}.</Text>

        {edition.mainCount === 0 ? (
          <Text style={s.empty}>Nothing to report in this window. The attached file is empty.</Text>
        ) : null}

        {edition.families.map((f) => (
          <Section key={f.key}>
            <Text style={s.familyHeading}>
              {f.label}: {f.items.length}
            </Text>
            <EventTable items={f.items} />
          </Section>
        ))}

        {edition.underReview.length ? (
          <Section>
            <Text style={s.reviewHeading}>Under review, not verified: {edition.underReview.length}</Text>
            <Text style={s.window}>These are candidates. Do not act on them as facts.</Text>
            <EventTable items={edition.underReview} />
          </Section>
        ) : null}

        <Text style={{ ...s.paragraph, marginTop: "22px", fontSize: "13px" }}>
          Attached: <strong>{edition.attachment.filename}</strong>, {edition.attachment.lines}{" "}
          {edition.attachment.lines === 1 ? "line" : "lines"}, one event per line in the published envelope.
          Dates are UTC. &ldquo;Known&rdquo; is when the event became publicly knowable; &ldquo;Effective&rdquo; is
          when it takes effect.
        </Text>

        <Section style={s.agentBox}>
          <Text style={s.agentHeading}>For agents and automation</Text>
          <Text style={s.agentText}>
            You can ignore this block. It describes the attached file so an agent can find and validate it.
          </Text>
          <pre style={s.pre}>{digestDescriptorJson(edition)}</pre>
        </Section>

        <Hr style={s.hr} />
        <Text style={s.small}>
          Questions or corrections: reply to this email or write to{" "}
          <Link href={`mailto:${DIGEST_CONTACT_EMAIL}`} style={s.link}>
            {DIGEST_CONTACT_EMAIL}
          </Link>
          .
        </Text>
        <Text style={s.small}>{DIGEST_FOOTER_LEGAL}</Text>
      </Container>
    </Body>
  </Html>
);

export default EventLedgerDigestEmail;
