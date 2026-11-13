import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from "@react-email/components";
import * as React from "react";
import { BASE_URL } from "./constants";
import { FeedFooter, FeedHeader, FEED_LOGO_URL, styles } from "./feed-shared";

/**
 * Confirmation of a team-inbox request made from an Event Ledger edition footer
 * ("Send this to your team inbox instead"). Sent to the CONTACT's own address,
 * never to the inbox, so whoever holds a forwarded copy of an edition cannot
 * re-route someone else's delivery. Nothing changes until the contact clicks;
 * then the inbox is asked to confirm for itself (emails/feed-delivery-confirm.tsx).
 */
export interface FeedDeliveryChangeEmailProps {
  name?: string | null;
  /** The team inbox the request names. */
  inbox: string;
  /** Whether the request also stops delivery to the contact's own address once the inbox confirms. */
  stopContact: boolean;
  /** Page with the confirm button; carries the single-use token. */
  confirmUrl: string;
  unsubscribeUrl: string;
  logoSrc?: string;
}

export const FEED_DELIVERY_CHANGE_SUBJECT = "Confirm: send the RiskModels Event Ledger to your team inbox";

export const FeedDeliveryChangeEmail = ({
  name = null,
  inbox = "your team inbox",
  stopContact = false,
  confirmUrl = `${BASE_URL}/security-master-feed/delivery/confirm`,
  unsubscribeUrl = `${BASE_URL}/security-master-feed/unsubscribe`,
  logoSrc = FEED_LOGO_URL,
}: FeedDeliveryChangeEmailProps) => (
  <Html>
    <Head />
    <Preview>{`Confirm sending the Event Ledger to ${inbox}.`}</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <FeedHeader logoSrc={logoSrc} />
        <Heading style={styles.heading}>Send the Event Ledger to a team inbox?</Heading>

        <Text style={styles.paragraph}>{name ? `Hello ${name},` : "Hello,"}</Text>

        <Text style={styles.paragraph}>
          Someone used the link in your copy of the Event Ledger to ask for the editions to go to{" "}
          <strong>{inbox}</strong>.
          {stopContact
            ? " Once that inbox confirms, editions will stop coming to this address."
            : " This address will keep receiving them as well."}
        </Text>

        <Section style={styles.buttonWrap}>
          <Button style={styles.button} href={confirmUrl}>
            Confirm the team inbox
          </Button>
        </Section>

        <Text style={styles.paragraph}>
          After you confirm, we ask {inbox} to confirm for itself; nothing is delivered there until it does. If you
          did not ask for this, ignore this email and nothing changes. The link works once and expires in seven days.
        </Text>

        <FeedFooter
          reason="You are receiving this because this address is on the Event Ledger list."
          unsubscribeUrl={unsubscribeUrl}
        />
      </Container>
    </Body>
  </Html>
);

export default FeedDeliveryChangeEmail;
