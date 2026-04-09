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
import { BASE_URL, LOGO_URL } from "./constants";

interface LowBalanceEmailProps {
  userName: string;
  balanceUsd: number;
  thresholdUsd: number;
  topUpUrl: string;
}

export const LowBalanceEmail = ({
  userName = "Developer",
  balanceUsd = 4.5,
  thresholdUsd = 5.0,
  topUpUrl = `${BASE_URL}/settings/billing`,
}: LowBalanceEmailProps) => (
  <Html>
    <Head />
    <Preview>
      Your RiskModels API balance is running low — top up to keep going
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Img
          src={LOGO_URL}
          width="48"
          height="48"
          alt="RiskModels"
          style={logo}
        />
        <Heading style={heading}>API Balance Running Low</Heading>

        <Text style={paragraph}>Hi {userName},</Text>

        <Text style={paragraph}>
          Your RiskModels API balance has dropped below{" "}
          <strong>${thresholdUsd.toFixed(2)}</strong>. You currently have{" "}
          <strong>${balanceUsd.toFixed(4)}</strong> remaining.
        </Text>

        <Section style={alertContainer}>
          <Text style={alertText}>
            ⚠️ API requests will stop processing when your balance reaches{" "}
            <strong>$0.00</strong>. Top up now to avoid interruption.
          </Text>
        </Section>

        <Section style={buttonContainer}>
          <Button style={button} href={topUpUrl}>
            Top Up Your Balance
          </Button>
        </Section>

        <Hr style={hr} />

        <Heading as="h2" style={subheading}>
          What your credits are used for:
        </Heading>

        <Text style={paragraph}>
          • <strong>Ticker Returns:</strong> $0.005 per request — daily returns,
          price, and <strong>L3</strong> hedge ratios &amp; explained risk (time
          series); use <strong>L3 Decomposition</strong> or <strong>Metrics</strong>{" "}
          for broader history / snapshot fields
          <br />• <strong>Batch Analysis:</strong> $0.002 per position —
          portfolio hedge ratios in one call (25% cheaper)
          <br />• <strong>L3 Decomposition:</strong> factor risk attribution —
          market, sector, subsector &amp; idiosyncratic
          <br />• <strong>Ticker Metrics:</strong> latest volatility (23d),
          L1/L2/L3 hedge ratios &amp; explained risk, price, market cap, and
          sector / subsector ETF metadata per ticker
        </Text>

        <Hr style={hr} />

        <Text style={paragraph}>
          Questions? Reply to this email or contact{" "}
          <Link href="mailto:service@riskmodels.app" style={link}>
            service@riskmodels.app
          </Link>
          .
        </Text>

        <Text style={footer}>
          RiskModels — Institutional Risk Analysis via API
          <br />
          <Link href={BASE_URL} style={footerLink}>
            riskmodels.app
          </Link>
        </Text>
      </Container>
    </Body>
  </Html>
);

export default LowBalanceEmail;

const main = {
  backgroundColor: "#f6f9fc",
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  padding: "20px 0 48px",
  marginBottom: "64px",
};

const logo = {
  margin: "0 auto",
  display: "block",
};

const heading = {
  fontSize: "32px",
  lineHeight: "1.3",
  fontWeight: "700",
  color: "#d97706",
  textAlign: "center" as const,
  margin: "30px 0",
};

const subheading = {
  fontSize: "21px",
  lineHeight: "1.4",
  fontWeight: "600",
  color: "#1a1a1a",
  margin: "20px 0 10px",
};

const paragraph = {
  fontSize: "16px",
  lineHeight: "1.6",
  color: "#4a5568",
  margin: "16px 0",
  padding: "0 20px",
};

const alertContainer = {
  backgroundColor: "#fffbeb",
  borderLeft: "4px solid #f59e0b",
  borderRadius: "4px",
  padding: "20px",
  margin: "24px 20px",
};

const alertText = {
  fontSize: "16px",
  color: "#92400e",
  margin: "0",
};

const buttonContainer = {
  textAlign: "center" as const,
  margin: "32px 0",
};

const button = {
  backgroundColor: "#10b981",
  borderRadius: "5px",
  color: "#fff",
  fontSize: "16px",
  fontWeight: "bold",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "14px 32px",
};

const hr = {
  borderColor: "#e2e8f0",
  margin: "32px 0",
};

const link = {
  color: "#3b82f6",
  textDecoration: "underline",
};

const footer = {
  color: "#8898aa",
  fontSize: "14px",
  lineHeight: "24px",
  textAlign: "center" as const,
  padding: "0 20px",
  margin: "32px 0 0",
};

const footerLink = {
  color: "#8898aa",
  textDecoration: "underline",
};
