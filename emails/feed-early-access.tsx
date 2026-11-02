import { Body, Container, Head, Heading, Html, Link, Preview, Section, Text } from "@react-email/components";
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
 * Sent once, on a new early-access signup with consent_feed_emails = true
 * (POST /api/feed-waitlist). The feed is not live: this email promises the spec
 * and an illustrative sample before the first edition, and makes no coverage or
 * latency claims.
 */
export interface FeedEarlyAccessEmailProps {
  name?: string | null;
  feedPageUrl: string;
  unsubscribeUrl: string;
  /** Override for previews and test sends (e.g. a cid: image). */
  logoSrc?: string;
}

export const FEED_EARLY_ACCESS_SUBJECT =
  "You're on the early-access list for the RiskModels security master feed";

export const FeedEarlyAccessEmail = ({
  name = null,
  feedPageUrl = `${BASE_URL}/security-master-feed`,
  unsubscribeUrl = `${BASE_URL}/security-master-feed/unsubscribe`,
  logoSrc = FEED_LOGO_URL,
}: FeedEarlyAccessEmailProps) => (
  <Html>
    <Head />
    <Preview>
      You are on the early-access list. We will send the spec and a sample before the first edition.
    </Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <FeedHeader logoSrc={logoSrc} />
        <Heading style={styles.heading}>You are on the early-access list</Heading>

        <Text style={styles.paragraph}>{name ? `Hi ${name},` : "Hello,"}</Text>

        <Text style={styles.paragraph}>
          Thank you for signing up for the RiskModels security master change feed. The feed is in early
          access and has not published its first edition yet.
        </Text>

        <Section style={styles.box}>
          <Text style={styles.boxHeading}>What each edition will contain</Text>
          <Text style={styles.boxText}>
            US equity identity and status events: ticker and name changes, listing status, mergers and
            reorganisations, and splits. Each event cites the SEC filing that supports it.
          </Text>
          <Text style={styles.boxText}>
            Corrections to facts published in earlier editions, with the old value, the new value and the
            reason.
          </Text>
          <Text style={styles.boxTextLast}>
            Securities are identified by FIGI, CIK, ticker and the RiskModels id.
          </Text>
        </Section>

        <FeedFit />

        <Text style={styles.paragraph}>
          <strong>What happens next.</strong> Before the first edition we will email you the specification
          and an illustrative sample. Early clients receive the feed free for about the first year.
        </Text>

        <FeedFeedbackAsk
          heading="Tell us what you need"
          lines={[
            "Early-access members shape the feed before it launches. Reply to this email with a line or two on any of these:",
            "Which events matter most to your work, and which you would ignore. The identifiers you join on, and how you handle a ticker that is reused. How you want it delivered: an email digest, the API or a webhook. Which system or process you would reconcile it against. A recent rename, merger or delisting that tripped up your data.",
            "Every reply is read by the team building the feed.",
          ]}
        />

        <Text style={styles.paragraph}>
          <Link href={feedPageUrl} style={styles.link}>
            About the feed
          </Link>
        </Text>

        <FeedAgentBlock />

        <FeedFooter
          reason="You are receiving this because you signed up at riskmodels.app and agreed to feed emails."
          unsubscribeUrl={unsubscribeUrl}
        />
      </Container>
    </Body>
  </Html>
);

export default FeedEarlyAccessEmail;
