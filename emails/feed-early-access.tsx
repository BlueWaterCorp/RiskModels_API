import { Body, Container, Head, Heading, Html, Link, Preview, Section, Text } from "@react-email/components";
import * as React from "react";
import { BASE_URL } from "./constants";
import {
  FeedAgentBlock,
  FeedFeedbackAsk,
  FeedFit,
  FeedFooter,
  FeedHeader,
  FeedInviteOffer,
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
  /** This address's own colleague link. Omitted when the code is not available. */
  inviteUrl?: string | null;
  /** Override for previews and test sends (e.g. a cid: image). */
  logoSrc?: string;
}

export const FEED_EARLY_ACCESS_SUBJECT = "You are confirmed for the RiskModels security master feed";

export const FeedEarlyAccessEmail = ({
  name = null,
  feedPageUrl = `${BASE_URL}/security-master-feed`,
  unsubscribeUrl = `${BASE_URL}/security-master-feed/unsubscribe`,
  inviteUrl = null,
  logoSrc = FEED_LOGO_URL,
}: FeedEarlyAccessEmailProps) => (
  <Html>
    <Head />
    <Preview>This address is confirmed for the RiskModels security master change feed.</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <FeedHeader logoSrc={logoSrc} />
        <Heading style={styles.heading}>You are confirmed</Heading>

        <Text style={styles.paragraph}>{name ? `Hi ${name},` : "Hello,"}</Text>

        <Text style={styles.paragraph}>
          This address is confirmed for the RiskModels security master change feed. Editions are sent as they
          are published.
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
          <strong>What happens next.</strong> Editions are sent as they are published. Early clients receive the
          feed free for about the first year.
        </Text>

        <FeedFeedbackAsk
          heading="Tell us what you need"
          lines={[
            "Reply to this email with a line or two on any of these:",
            "Which events matter most to your work, and which you would ignore. The identifiers you join on, and how you handle a ticker that is reused. How you want it delivered: an email digest, the API or a webhook. Which system or process you would reconcile it against. A recent rename, merger or delisting that tripped up your data.",
            "Every reply is read by the team building the feed.",
          ]}
        />

        <Text style={styles.paragraph}>
          <Link href={feedPageUrl} style={styles.link}>
            About the feed
          </Link>
        </Text>

        {inviteUrl ? <FeedInviteOffer inviteUrl={inviteUrl} /> : null}

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
