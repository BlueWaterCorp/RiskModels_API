import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";
import { BASE_URL, SUPPORT_EMAIL } from "./constants";

/**
 * Sent to the contact address an API client supplied to POST /api/auth/provision.
 * The address is unverified until the recipient opens the link and presses the
 * button on that page (a mail scanner fetching the link confirms nothing).
 * Ignoring the email leaves the account on free-tier limits and the address
 * unrecorded as a contact.
 */
export interface AccountClaimEmailProps {
  agentName: string;
  /** Page with the confirm button; carries the single-use token. */
  claimUrl: string;
  expiresAtFormatted: string;
}

export const ACCOUNT_CLAIM_SUBJECT = "Confirm your email for a RiskModels API account";

export const AccountClaimEmail = ({
  agentName = "an API client",
  claimUrl = `${BASE_URL}/api/auth/provision/claim`,
  expiresAtFormatted = "",
}: AccountClaimEmailProps) => (
  <Html>
    <Head />
    <Preview>Confirm this address as the contact for a RiskModels API account.</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={heading}>Confirm your email</Heading>

        <Text style={paragraph}>
          A program calling the RiskModels API created an account named{" "}
          <strong>{agentName}</strong> and gave this address as its contact.
        </Text>

        <Text style={paragraph}>
          If you run that program, confirm below. The account then moves off the free-tier limits
          (100 requests a day) and carries the one-time $20 starter credit. Account notices such as
          low balance and key expiry will be sent here.
        </Text>

        <Section style={buttonContainer}>
          <Button style={button} href={claimUrl}>
            Review and confirm
          </Button>
        </Section>

        <Text style={paragraph}>
          If you did not ask for this, ignore this email. Nothing is recorded against your address,
          and the link stops working{expiresAtFormatted ? ` on ${expiresAtFormatted}` : " after 7 days"}.
          Confirming does not give anyone access to an account you already hold.
        </Text>

        <Hr style={hr} />

        <Text style={small}>
          Questions?{" "}
          <Link href={`mailto:${SUPPORT_EMAIL}`} style={link}>
            {SUPPORT_EMAIL}
          </Link>
        </Text>
      </Container>
    </Body>
  </Html>
);

export default AccountClaimEmail;

const main = {
  backgroundColor: "#f6f9fc",
  fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};
const container = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  padding: "32px 24px 40px",
  maxWidth: "560px",
};
const heading = { fontSize: "22px", fontWeight: 600, color: "#1a1a1a", margin: "0 0 20px" };
const paragraph = { fontSize: "15px", lineHeight: "24px", color: "#333333", margin: "0 0 16px" };
const buttonContainer = { margin: "24px 0" };
const button = {
  backgroundColor: "#002a5e",
  borderRadius: "6px",
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: 600,
  textDecoration: "none",
  padding: "12px 20px",
};
const hr = { borderColor: "#e6ebf1", margin: "24px 0" };
const small = { fontSize: "13px", lineHeight: "20px", color: "#666666" };
const link = { color: "#006f8e" };
