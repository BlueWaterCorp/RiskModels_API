import {
  Body,
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
import { BASE_URL, LOGO_PNG_URL, SUPPORT_EMAIL } from "./constants";

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
}

export const FEED_EARLY_ACCESS_SUBJECT =
  "You're on the early-access list for the RiskModels security master feed";

export const FeedEarlyAccessEmail = ({
  name = null,
  feedPageUrl = `${BASE_URL}/security-master-feed`,
  unsubscribeUrl = `${BASE_URL}/security-master-feed/unsubscribe`,
}: FeedEarlyAccessEmailProps) => (
  <Html>
    <Head />
    <Preview>
      You are on the early-access list. We will send the spec and a sample before the first edition.
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Img src={LOGO_PNG_URL} width="96" alt="RiskModels" style={logo} />
        <Heading style={heading}>You are on the early-access list</Heading>

        <Text style={paragraph}>{name ? `Hi ${name},` : "Hello,"}</Text>

        <Text style={paragraph}>
          Thank you for signing up for the RiskModels security master change feed. The feed is in
          early access and has not published its first edition yet.
        </Text>

        <Section style={box}>
          <Text style={boxHeading}>What each edition will contain</Text>
          <Text style={boxText}>
            US equity identity and status events: ticker and name changes, listing status, mergers
            and reorganisations, and splits. Each event cites the SEC filing that supports it.
          </Text>
          <Text style={boxText}>
            Corrections to facts published in earlier editions, with the old value, the new value
            and the reason.
          </Text>
          <Text style={boxTextLast}>
            Securities are identified by FIGI, CIK, ticker and the RiskModels id.
          </Text>
        </Section>

        <Text style={paragraph}>
          <strong>What happens next.</strong> Before the first edition we will email you the
          specification and an illustrative sample. Early clients receive the feed free for about the
          first year.
        </Text>

        <Section style={feedbackBox}>
          <Text style={boxHeading}>Tell us what you need</Text>
          <Text style={boxText}>
            Early-access members shape the feed before it launches. Reply to this email with a line
            or two on any of these:
          </Text>
          <Text style={boxText}>
            Which events matter most to your work, and which you would ignore.
            <br />
            The identifiers you join on, and how you handle a ticker that is reused.
            <br />
            How you want it delivered: an email digest, the API or a webhook.
            <br />
            A recent rename, merger or delisting that tripped up your data.
          </Text>
          <Text style={boxTextLast}>Every reply is read by the team building the feed.</Text>
        </Section>

        <Text style={paragraph}>
          <Link href={feedPageUrl} style={link}>
            About the feed
          </Link>
        </Text>

        <Hr style={hr} />

        <Text style={small}>
          You are receiving this because you signed up at riskmodels.app and agreed to feed emails.{" "}
          <Link href={unsubscribeUrl} style={link}>
            Unsubscribe
          </Link>
          {" · "}
          <Link href={`mailto:${SUPPORT_EMAIL}`} style={link}>
            {SUPPORT_EMAIL}
          </Link>
        </Text>
        <Text style={small}>
          RiskModels is a registered DBA of Blue Water Macro Corp. Historical, end-of-day data. Not
          investment advice.
        </Text>
      </Container>
    </Body>
  </Html>
);

export default FeedEarlyAccessEmail;

const main = {
  backgroundColor: "#f6f9fc",
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};
const container = { backgroundColor: "#ffffff", margin: "0 auto", padding: "32px 24px 40px", maxWidth: "560px" };
const logo = { margin: "0 0 20px", display: "block" as const };
const heading = { color: "#002a5e", fontSize: "22px", fontWeight: "600", lineHeight: "1.3", margin: "0 0 16px" };
const paragraph = { color: "#334155", fontSize: "15px", lineHeight: "1.6", margin: "0 0 16px" };
const box = {
  backgroundColor: "#f5f7fb",
  borderRadius: "6px",
  border: "1px solid #e2e8f0",
  padding: "14px 16px",
  margin: "0 0 20px",
};
const boxHeading = { color: "#002a5e", fontSize: "14px", fontWeight: "600", margin: "0 0 8px" };
const boxText = { color: "#1f2937", fontSize: "14px", lineHeight: "1.55", margin: "0 0 8px" };
const boxTextLast = { ...boxText, margin: "0" };
const feedbackBox = { ...box, backgroundColor: "#ffffff", border: "1px solid #002a5e" };
const link = { color: "#0369a1", textDecoration: "underline" };
const hr = { borderColor: "#e2e8f0", margin: "24px 0 16px" };
const small = { color: "#64748b", fontSize: "12px", lineHeight: "1.5", margin: "0 0 8px" };
