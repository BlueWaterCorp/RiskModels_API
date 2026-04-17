import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";
import { BASE_URL, LOGO_URL, SUPPORT_EMAIL } from "./constants";

export interface KeyExpiringEmailProps {
  userName: string;
  keyName: string;
  keyPrefix: string;
  expiresAtFormatted: string;
  daysRemaining: number;
  manageKeysUrl: string;
  docsUrl: string;
}

export const KeyExpiringEmail = ({
  userName = "Developer",
  keyName = "API Key 1",
  keyPrefix = "rm_agent_live_",
  expiresAtFormatted = "April 17, 2027",
  daysRemaining = 14,
  manageKeysUrl = `${BASE_URL}/get-key`,
  docsUrl = `${BASE_URL}/docs/authentication`,
}: KeyExpiringEmailProps) => (
  <Html>
    <Head />
    <Preview>
      {`Your RiskModels API key expires in ${daysRemaining} day${
        daysRemaining === 1 ? "" : "s"
      } — renew or rotate before ${expiresAtFormatted}`}
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Img src={LOGO_URL} width="48" height="48" alt="RiskModels" style={logo} />
        <Heading style={heading}>API key expiring soon</Heading>

        <Text style={paragraph}>Hi {userName},</Text>

        <Text style={paragraph}>
          Your key <strong>{keyName}</strong> (
          <code style={inlineCode}>{keyPrefix}…</code>) will stop working on{" "}
          <strong>{expiresAtFormatted}</strong> — about{" "}
          <strong>{daysRemaining}</strong> calendar day
          {daysRemaining === 1 ? "" : "s"} from now.
        </Text>

        <Section style={alertContainer}>
          <Text style={alertText}>
            After expiry, requests with this key return{" "}
            <strong>401</strong> until you create a new key. Your prepaid balance
            is unchanged; only the credential rotates.
          </Text>
        </Section>

        <Section style={buttonContainer}>
          <Button style={button} href={manageKeysUrl}>
            Manage API keys
          </Button>
        </Section>

        <Text style={paragraph}>
          From the dashboard you can <strong>revoke</strong> the old key (optional)
          and <strong>generate</strong> a new one. Update{" "}
          <code style={inlineCode}>RISKMODELS_API_KEY</code> in your apps, CI, and
          MCP client configs.
        </Text>

        <Hr style={hr} />

        <Text style={small}>
          Questions?{" "}
          <Link href={`mailto:${SUPPORT_EMAIL}`} style={link}>
            {SUPPORT_EMAIL}
          </Link>
          {" · "}
          <Link href={docsUrl} style={link}>
            Authentication docs
          </Link>
        </Text>
      </Container>
    </Body>
  </Html>
);

export default KeyExpiringEmail;

const main = {
  backgroundColor: "#09090b",
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  margin: "0 auto",
  padding: "32px 24px 48px",
  maxWidth: "560px",
};

const logo = { margin: "0 auto 16px", display: "block" as const };

const heading = {
  color: "#fafafa",
  fontSize: "22px",
  fontWeight: "600",
  lineHeight: "1.3",
  margin: "0 0 16px",
};

const paragraph = {
  color: "#a1a1aa",
  fontSize: "15px",
  lineHeight: "1.6",
  margin: "0 0 16px",
};

const alertContainer = {
  backgroundColor: "#18181b",
  borderRadius: "8px",
  border: "1px solid #3f3f46",
  padding: "14px 16px",
  margin: "0 0 20px",
};

const alertText = {
  color: "#e4e4e7",
  fontSize: "14px",
  lineHeight: "1.55",
  margin: "0",
};

const buttonContainer = { textAlign: "center" as const, margin: "0 0 24px" };

const button = {
  backgroundColor: "#2563eb",
  borderRadius: "8px",
  color: "#fff",
  fontSize: "15px",
  fontWeight: "600",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "12px 24px",
};

const hr = { borderColor: "#27272a", margin: "24px 0" };

const small = { color: "#71717a", fontSize: "12px", lineHeight: "1.5", margin: "0" };

const link = { color: "#60a5fa", textDecoration: "underline" };

const inlineCode = {
  backgroundColor: "#27272a",
  padding: "2px 6px",
  borderRadius: "4px",
  fontSize: "13px",
  color: "#e4e4e7",
};
