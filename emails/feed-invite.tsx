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
 * Personal invitation. Sent once to an address a named person added by hand
 * (lib/feed-invite.ts). The recipient has not signed up, so nothing is sent
 * after this unless they join the list themselves: the row is stored with
 * consent_feed_emails = false and only joining through the form, or replying
 * with a yes, changes that.
 */
export interface FeedInviteEmailProps {
  name?: string | null;
  /** Who added the address and is inviting the recipient, e.g. "Conrad Gann". */
  inviterName: string;
  /** Optional line under the name, e.g. "founder of RiskModels". */
  inviterRole?: string | null;
  /** Optional personal note from the inviter, shown above the description. */
  note?: string | null;
  /** The signup form. Carries a source tag so invited joins can be told apart. */
  joinUrl: string;
  feedPageUrl: string;
  unsubscribeUrl: string;
  /** Override for previews and test sends (e.g. a cid: image). */
  logoSrc?: string;
}

export const feedInviteSubject = (inviterName: string) =>
  `${inviterName} invited you to see the RiskModels security master feed`;

export const FeedInviteEmail = ({
  name = null,
  inviterName = "Conrad Gann",
  inviterRole = "founder of RiskModels",
  note = null,
  joinUrl = `${BASE_URL}/security-master-feed?utm_source=invite`,
  feedPageUrl = `${BASE_URL}/security-master-feed`,
  unsubscribeUrl = `${BASE_URL}/security-master-feed/unsubscribe`,
  logoSrc = FEED_LOGO_URL,
}: FeedInviteEmailProps) => (
  <Html>
    <Head />
    <Preview>{`You have been invited by ${inviterName} to see the RiskModels security master feed.`}</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <FeedHeader logoSrc={logoSrc} />

        <Heading style={styles.heading}>You have been invited to see this</Heading>

        <Text style={styles.banner}>
          You have been invited by <strong>{inviterName}</strong>
          {inviterRole ? `, ${inviterRole},` : ""} to see the RiskModels security master change feed.
        </Text>

        <Text style={styles.paragraph}>{name ? `Hi ${name},` : "Hello,"}</Text>

        {note ? <Text style={styles.paragraph}>{note}</Text> : null}

        <Text style={styles.paragraph}>
          The feed is a daily, SEC-filing-cited record of US equity identity and status events: ticker and
          name changes, listing status, mergers and reorganisations, and splits, with corrections to earlier
          editions and the date each fact became known. It is in early access and has not published its
          first edition yet. Early clients receive it free for about the first year.
        </Text>

        <FeedFit />

        <Section style={styles.buttonWrap}>
          <Button style={styles.button} href={joinUrl}>
            Join the early-access list
          </Button>
        </Section>

        <Text style={styles.paragraph}>
          You are not on the list yet, and we will not email you about the feed again unless you join. You
          can also reply to this email with a yes.{" "}
          <Link href={feedPageUrl} style={styles.link}>
            About the feed
          </Link>
        </Text>

        <FeedFeedbackAsk
          heading="Tell us what would make it useful"
          lines={[
            "Reply to this email with a line or two. Which events matter most to your work. Which system or process you would reconcile it against. How you would want it delivered: an email digest, the API or a webhook.",
            `Every reply is read by the team building the feed, and ${inviterName} will see it.`,
          ]}
        />

        <FeedAgentBlock />

        <FeedFooter
          reason={`${inviterName} asked us to send you this one-time invitation. You will not receive further feed email unless you join the list.`}
          unsubscribeUrl={unsubscribeUrl}
        />
      </Container>
    </Body>
  </Html>
);

export default FeedInviteEmail;
