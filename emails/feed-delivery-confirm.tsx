import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from "@react-email/components";
import * as React from "react";
import { BASE_URL } from "./constants";
import { FeedAgentBlock, FeedFooter, FeedHeader, FEED_LOGO_URL, styles } from "./feed-shared";

/**
 * Double opt-in for a feed DELIVERY address: the second address in the common
 * two-address signup, one for the person (contact) and one for the feed itself,
 * such as a team mailbox or an agent inbox. Sent only after the contact has
 * confirmed their own address and named this one. The address receives editions
 * only once it confirms here; ignoring the email leaves it off the list.
 *
 * The recipient may be an agent inbox, so the email carries the
 * machine-readable feed descriptor.
 */
export interface FeedDeliveryConfirmEmailProps {
  /** The contact who asked for delivery here, e.g. "A. Analyst (analyst@example.com)". */
  requestedBy: string;
  /** Page with the confirm button; carries the single-use token. */
  confirmUrl: string;
  unsubscribeUrl: string;
  /** Override for previews and test sends (e.g. a cid: image). */
  logoSrc?: string;
}

export const FEED_DELIVERY_CONFIRM_SUBJECT =
  "Confirm delivery of the RiskModels security master feed to this address";

export const FeedDeliveryConfirmEmail = ({
  requestedBy = "A contact",
  confirmUrl = `${BASE_URL}/security-master-feed/confirm`,
  unsubscribeUrl = `${BASE_URL}/security-master-feed/unsubscribe`,
  logoSrc = FEED_LOGO_URL,
}: FeedDeliveryConfirmEmailProps) => (
  <Html>
    <Head />
    <Preview>{`${requestedBy} asked us to deliver the RiskModels security master feed to this address.`}</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <FeedHeader logoSrc={logoSrc} />
        <Heading style={styles.heading}>Confirm delivery of the feed to this address</Heading>

        <Text style={styles.paragraph}>Hello,</Text>

        <Text style={styles.paragraph}>
          <strong>{requestedBy}</strong> asked us to deliver the RiskModels security master change feed to this
          address. The feed is a daily, SEC-filing-cited record of US equity identity and status events. It is in
          early access and has not published its first edition yet.
        </Text>

        <Text style={styles.paragraph}>
          This address would receive the editions only. Notices about the feed go to the contact who asked. You
          are not on the delivery list until you confirm.
        </Text>

        <Section style={styles.buttonWrap}>
          <Button style={styles.button} href={confirmUrl}>
            Confirm delivery to this address
          </Button>
        </Section>

        <Text style={styles.paragraph}>
          If you were not expecting this, ignore this email. Nothing will be delivered here, and we will not email
          this address again about the feed. The link works once and expires in seven days.
        </Text>

        <FeedAgentBlock />

        <FeedFooter
          reason="You are receiving this because a contact asked for the feed to be delivered to this address."
          unsubscribeUrl={unsubscribeUrl}
        />
      </Container>
    </Body>
  </Html>
);

export default FeedDeliveryConfirmEmail;
