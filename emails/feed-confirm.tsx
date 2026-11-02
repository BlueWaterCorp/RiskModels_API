import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from "@react-email/components";
import * as React from "react";
import { BASE_URL } from "./constants";
import { FeedFooter, FeedHeader, FEED_LOGO_URL, styles } from "./feed-shared";

/**
 * Double opt-in. Sent right after someone asks to join the early-access list,
 * and only to the address they gave. Nothing is recorded as consent until the
 * button is used (it opens a page that asks for one more click, so a mail
 * scanner that fetches the link cannot confirm anyone). Ignoring the email
 * leaves the address off the list.
 */
export interface FeedConfirmEmailProps {
  name?: string | null;
  /** Page with the confirm button; carries the single-use token. */
  confirmUrl: string;
  unsubscribeUrl: string;
  /** Override for previews and test sends (e.g. a cid: image). */
  logoSrc?: string;
}

export const FEED_CONFIRM_SUBJECT = "Confirm your email for the RiskModels security master feed";

export const FeedConfirmEmail = ({
  name = null,
  confirmUrl = `${BASE_URL}/security-master-feed/confirm`,
  unsubscribeUrl = `${BASE_URL}/security-master-feed/unsubscribe`,
  logoSrc = FEED_LOGO_URL,
}: FeedConfirmEmailProps) => (
  <Html>
    <Head />
    <Preview>Confirm your email to join the early-access list for the RiskModels security master feed.</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <FeedHeader logoSrc={logoSrc} />
        <Heading style={styles.heading}>Confirm your email</Heading>

        <Text style={styles.paragraph}>{name ? `Hi ${name},` : "Hello,"}</Text>

        <Text style={styles.paragraph}>
          Someone asked to join the early-access list for the RiskModels security master change feed with this
          email address. The feed is a daily, SEC-filing-cited record of US equity identity and status events. It
          is in early access and has not published its first edition yet.
        </Text>

        <Text style={styles.paragraph}>
          To join, confirm that this is your address. You are not on the list until you do.
        </Text>

        <Section style={styles.buttonWrap}>
          <Button style={styles.button} href={confirmUrl}>
            Confirm my email
          </Button>
        </Section>

        <Text style={styles.paragraph}>
          If you did not ask to join, ignore this email. You will not be added, and we will not email you about
          the feed. The link works once and expires in seven days.
        </Text>

        <FeedFooter
          reason="You are receiving this because this address was entered on the early-access form at riskmodels.app."
          unsubscribeUrl={unsubscribeUrl}
        />
      </Container>
    </Body>
  </Html>
);

export default FeedConfirmEmail;
