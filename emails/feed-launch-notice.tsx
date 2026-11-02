import { Body, Button, Container, Head, Heading, Html, Link, Preview, Section, Text } from "@react-email/components";
import * as React from "react";
import { BASE_URL } from "./constants";
import {
  FeedAgentBlock,
  FeedFeedbackAsk,
  FeedFit,
  FeedFooter,
  FeedHeader,
  FEED_LOGO_URL,
  styles,
} from "./feed-shared";

/**
 * One-time notice to consented early-access rows when the first edition is
 * published. Sent by an operator-run batch (lib/feed-email.ts
 * sendFeedLaunchNotice), never automatically. Every factual field is passed in
 * by the sender at send time, so the template itself makes no coverage,
 * latency or quality claim.
 */
export interface FeedLaunchNoticeEmailProps {
  name?: string | null;
  /** Date of the first published edition, e.g. "November 16, 2026". */
  firstEditionDate: string;
  /** ISO date of the first edition, for the machine-readable block, e.g. "2026-11-16". */
  firstEditionIso?: string | null;
  /** Where to read the first edition (page, sample or API docs). Must be live when this is sent. */
  editionUrl: string;
  /** The published specification. */
  specUrl: string;
  /** Optional dated quality scorecard; omitted from the email when not provided. */
  scorecardUrl?: string | null;
  unsubscribeUrl: string;
  /** Override for previews and test sends (e.g. a cid: image). */
  logoSrc?: string;
}

export const feedLaunchNoticeSubject = (firstEditionDate: string) =>
  `The RiskModels security master feed: first edition, ${firstEditionDate}`;

export const FeedLaunchNoticeEmail = ({
  name = null,
  firstEditionDate = "Month D, YYYY",
  firstEditionIso = null,
  editionUrl = `${BASE_URL}/security-master-feed`,
  specUrl = `${BASE_URL}/security-master-feed`,
  scorecardUrl = null,
  unsubscribeUrl = `${BASE_URL}/security-master-feed/unsubscribe`,
  logoSrc = FEED_LOGO_URL,
}: FeedLaunchNoticeEmailProps) => (
  <Html>
    <Head />
    <Preview>{`The first edition of the security master feed is published (${firstEditionDate}).`}</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <FeedHeader logoSrc={logoSrc} />
        <Heading style={styles.heading}>The first edition is published</Heading>

        <Text style={styles.paragraph}>{name ? `Hi ${name},` : "Hello,"}</Text>

        <Text style={styles.paragraph}>
          You joined the early-access list for the RiskModels security master change feed. The first
          edition was published on <strong>{firstEditionDate}</strong>.
        </Text>

        <Section style={styles.buttonWrap}>
          <Button style={styles.button} href={editionUrl}>
            Read the first edition
          </Button>
        </Section>

        <Text style={styles.paragraph}>
          Each edition lists the US equity identity and status events learned that day, each citing its
          SEC filing, and any corrections to earlier editions with the old value, the new value and the
          reason. Securities are identified by FIGI, CIK, ticker and the RiskModels id.
        </Text>

        <FeedFit />

        <Text style={styles.paragraph}>
          <Link href={specUrl} style={styles.link}>
            Read the specification
          </Link>
          {scorecardUrl ? (
            <>
              {" · "}
              <Link href={scorecardUrl} style={styles.link}>
                Quality scorecard
              </Link>
            </>
          ) : null}
        </Text>

        <Text style={styles.paragraph}>
          As an early client you receive the feed free for about the first year.
        </Text>

        <FeedFeedbackAsk
          heading="Your feedback decides what comes next"
          lines={[
            "Reply to this email and tell us what you found. An event we missed, a date or citation you think is wrong, an event type you would add, or a change to the delivery format. We publish corrections in the next edition, with the old value, the new value and the reason.",
          ]}
        />

        <FeedAgentBlock descriptor={{ status: "published", firstEdition: firstEditionIso }} />

        <FeedFooter
          reason="You are receiving this because you joined the early-access list at riskmodels.app and agreed to feed emails."
          unsubscribeUrl={unsubscribeUrl}
        />
      </Container>
    </Body>
  </Html>
);

export default FeedLaunchNoticeEmail;
