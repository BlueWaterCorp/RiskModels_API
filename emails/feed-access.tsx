import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from "@react-email/components";
import * as React from "react";
import { BASE_URL } from "./constants";
import { FeedFooter, FeedHeader, FEED_LOGO_URL, styles } from "./feed-shared";

/**
 * The link an approved subscriber uses to create a private feed address. Sent
 * only to an approved, confirmed contact that asked for it on
 * /security-master-feed/access. The link works once and for one hour. The feed
 * address itself is never emailed: it is shown once, on the page the link opens.
 */
export interface FeedAccessEmailProps {
  name?: string | null;
  /** Page with the create button; carries the single-use token. */
  accessUrl: string;
  unsubscribeUrl: string;
  logoSrc?: string;
}

export const FEED_ACCESS_SUBJECT = "Your private Event Ledger feed link";

export const FeedAccessEmail = ({
  name = null,
  accessUrl = `${BASE_URL}/security-master-feed/access/issue`,
  unsubscribeUrl = `${BASE_URL}/security-master-feed/unsubscribe`,
  logoSrc = FEED_LOGO_URL,
}: FeedAccessEmailProps) => (
  <Html>
    <Head />
    <Preview>Create your private Event Ledger feed address. The link works once, for one hour.</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <FeedHeader logoSrc={logoSrc} />
        <Heading style={styles.heading}>Create your private feed address</Heading>

        <Text style={styles.paragraph}>{name ? `Hello ${name},` : "Hello,"}</Text>

        <Text style={styles.paragraph}>
          You asked for a private RSS address for the RiskModels Event Ledger. Open the page below and press the
          button there. It shows your feed address once, so have your feed reader ready.
        </Text>

        <Section style={styles.buttonWrap}>
          <Button style={styles.button} href={accessUrl}>
            Create my feed address
          </Button>
        </Section>

        <Text style={styles.paragraph}>
          The link works once and expires in one hour. Creating a new address replaces any earlier one, which stops
          working. The address is personal to you: please do not share or publish it. Unsubscribing ends it.
        </Text>

        <Text style={styles.paragraph}>If you did not ask for this, ignore this email and nothing changes.</Text>

        <FeedFooter
          reason="You are receiving this because this address is an approved Event Ledger subscriber and a feed address was requested for it."
          unsubscribeUrl={unsubscribeUrl}
        />
      </Container>
    </Body>
  </Html>
);

export default FeedAccessEmail;
