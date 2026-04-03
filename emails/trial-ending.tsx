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

interface TrialEndingEmailProps {
  userName: string;
  trialEndsAt: string;
  upgradeUrl: string;
}

export const TrialEndingEmail = ({
  userName = "there",
  trialEndsAt = "in 3 days",
  upgradeUrl = `${BASE_URL}/pricing?tab=investors`,
}: TrialEndingEmailProps) => (
  <Html>
    <Head />
    <Preview>
      Your RiskModels trial ends soon — Keep your Risk Monitor dashboard
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
        <Heading style={heading}>Your Trial Ends {trialEndsAt}</Heading>

        <Text style={paragraph}>Hi {userName},</Text>

        <Text style={paragraph}>
          Your free trial of RiskModels is ending soon. We hope you&apos;ve
          gotten value from your <strong>Risk Monitor dashboard</strong> — the
          one place to see your portfolio&apos;s real exposure across 41
          factors, hedge recommendations, and risk alerts.
        </Text>

        <Section style={highlightBox}>
          <Text style={highlightHeading}>What you&apos;ve had access to:</Text>
          <Text style={highlightItem}>
            • Real-time Risk Index — factor decomposition of your holdings
          </Text>
          <Text style={highlightItem}>
            • Hedge recipes — precise SPY, XLK, and subsector ETF ratios
          </Text>
          <Text style={highlightItem}>
            • Zero-knowledge encryption — we never read your holdings
          </Text>
        </Section>

        <Section style={buttonContainer}>
          <Button style={button} href={upgradeUrl}>
            Upgrade to Pro — Keep Your Risk Monitor
          </Button>
        </Section>

        <Text style={paragraph}>
          Pro gives you unlimited syncs, weekly insights, and smart alerts so
          your portfolio stays guarded while you live your life.
        </Text>

        <Hr style={hr} />

        <Text style={paragraph}>
          <strong>Questions or feedback?</strong> We&apos;d love to hear from
          you. Email us at{" "}
          <Link href="mailto:service@riskmodels.app" style={contactLink}>
            service@riskmodels.app
          </Link>
          .
        </Text>

        <Text style={footer}>
          RiskModels — Intelligent Risk Monitoring, Always On
          <br />
          <Link href={BASE_URL} style={footerLink}>
            riskmodels.app
          </Link>
        </Text>
      </Container>
    </Body>
  </Html>
);

export default TrialEndingEmail;

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
  color: "#1a1a1a",
  textAlign: "center" as const,
  margin: "30px 0",
};

const paragraph = {
  fontSize: "16px",
  lineHeight: "1.6",
  color: "#4a5568",
  margin: "16px 0",
  padding: "0 20px",
};

const highlightBox = {
  backgroundColor: "#f0fdf4",
  borderLeft: "4px solid #10b981",
  borderRadius: "8px",
  padding: "20px 24px",
  margin: "24px 20px",
};

const highlightHeading = {
  fontSize: "16px",
  fontWeight: "600",
  color: "#065f46",
  marginBottom: "12px",
};

const highlightItem = {
  fontSize: "15px",
  color: "#047857",
  margin: "8px 0",
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

const contactLink = {
  color: "#10b981",
  fontWeight: "600",
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
