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
import { BASE_URL, LOGO_PNG_URL, SUPPORT_EMAIL } from "./constants";

/**
 * One-time notice to consented early-access rows when the first edition is
 * published. Sent by an operator-run batch (lib/feed-email.ts
 * sendFeedLaunchNotice), never automatically. Every factual field is passed in
 * by the sender at send time, so the template itself makes no coverage,
 * latency or quality claim.
 */
export interface FeedLaunchNoticeEmailProps {
  name?: string | null;
  /** Date of the first published edition, e.g. "November 16, 2026". */
  firstEditionDate: string;
  /** Where to read the first edition (page, sample or API docs). */
  editionUrl: string;
  /** The published specification. */
  specUrl: string;
  /** Optional dated quality scorecard; omitted from the email when not provided. */
  scorecardUrl?: string | null;
  unsubscribeUrl: string;
}

export const feedLaunchNoticeSubject = (firstEditionDate: string) =>
  `The RiskModels security master feed: first edition, ${firstEditionDate}`;

export const FeedLaunchNoticeEmail = ({
  name = null,
  firstEditionDate = "Month D, YYYY",
  editionUrl = `${BASE_URL}/security-master-feed`,
  specUrl = `${BASE_URL}/security-master-feed`,
  scorecardUrl = null,
  unsubscribeUrl = `${BASE_URL}/security-master-feed/unsubscribe`,
}: FeedLaunchNoticeEmailProps) => (
  <Html>
    <Head />
    <Preview>{`The first edition of the security master feed is published (${firstEditionDate}).`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img src={LOGO_PNG_URL} width="96" alt="RiskModels" style={logo} />
        <Heading style={heading}>The first edition is published</Heading>

        <Text style={paragraph}>{name ? `Hi ${name},` : "Hello,"}</Text>

        <Text style={paragraph}>
          You joined the early-access list for the RiskModels security master change feed. The first
          edition was published on <strong>{firstEditionDate}</strong>.
        </Text>

        <Section style={buttonWrap}>
          <Button style={button} href={editionUrl}>
            Read the first edition
          </Button>
        </Section>

        <Text style={paragraph}>
          Each edition lists the US equity identity and status events learned that day, each citing
          its SEC filing, and any corrections to earlier editions with the old value, the new value
          and the reason. Securities are identified by FIGI, CIK, ticker and the RiskModels id.
        </Text>

        <Text style={paragraph}>
          <Link href={specUrl} style={link}>
            Read the specification
          </Link>
          {scorecardUrl ? (
            <>
              {" · "}
              <Link href={scorecardUrl} style={link}>
                Quality scorecard
              </Link>
            </>
          ) : null}
        </Text>

        <Text style={paragraph}>
          As an early client you receive the feed free for about the first year.
        </Text>

        <Section style={feedbackBox}>
          <Text style={feedbackHeading}>Your feedback decides what comes next</Text>
          <Text style={feedbackText}>
            Reply to this email and tell us what you found. An event we missed, a date or citation
            you think is wrong, an event type you would add, or a change to the delivery format. We
            publish corrections in the next edition, with the old value, the new value and the
            reason.
          </Text>
        </Section>

        <Hr style={hr} />

        <Text style={small}>
          You are receiving this because you joined the early-access list at riskmodels.app and agreed
          to feed emails.{" "}
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

export default FeedLaunchNoticeEmail;

const main = {
  backgroundColor: "#f6f9fc",
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};
const container = { backgroundColor: "#ffffff", margin: "0 auto", padding: "32px 24px 40px", maxWidth: "560px" };
const logo = { margin: "0 0 20px", display: "block" as const };
const heading = { color: "#002a5e", fontSize: "22px", fontWeight: "600", lineHeight: "1.3", margin: "0 0 16px" };
const paragraph = { color: "#334155", fontSize: "15px", lineHeight: "1.6", margin: "0 0 16px" };
const buttonWrap = { margin: "4px 0 20px" };
const button = {
  backgroundColor: "#002a5e",
  borderRadius: "4px",
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: "600",
  textDecoration: "none",
  padding: "12px 20px",
  display: "inline-block" as const,
};
const feedbackBox = {
  backgroundColor: "#ffffff",
  borderRadius: "6px",
  border: "1px solid #002a5e",
  padding: "14px 16px",
  margin: "0 0 20px",
};
const feedbackHeading = { color: "#002a5e", fontSize: "14px", fontWeight: "600", margin: "0 0 8px" };
const feedbackText = { color: "#1f2937", fontSize: "14px", lineHeight: "1.55", margin: "0" };
const link = { color: "#0369a1", textDecoration: "underline" };
const hr = { borderColor: "#e2e8f0", margin: "24px 0 16px" };
const small = { color: "#64748b", fontSize: "12px", lineHeight: "1.5", margin: "0 0 8px" };
