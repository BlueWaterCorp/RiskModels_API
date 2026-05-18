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

export interface SnapshotDigestItemProps {
  label: string;
  kind: "stock" | "fund";
  /** Snapshot matrix id for labeling and analytics (e.g. R1, P1, F1). */
  reportId?: string;
  /** Single newsletter bullet — one insight line per report (see J.12 spec). */
  highlight: string;
  interactiveUrl: string;
}

export interface SnapshotDigestEmailProps {
  userName: string;
  periodLabel: string;
  /** Masthead subline, e.g. "May 2026 · Watchlist digest". Falls back to periodLabel. */
  issueLabel?: string;
  executiveSummary: string;
  items: SnapshotDigestItemProps[];
  primaryCtaUrl: string;
  primaryCtaLabel: string;
  decomposeDocsUrl: string;
  apiExampleCaption: string;
  /** Preformatted code (e.g. curl or Python) — keep ASCII for email clients */
  apiExampleCode: string;
}

export const SnapshotDigestEmail = ({
  userName = "there",
  periodLabel = "this month",
  issueLabel: issueLabelProp,
  executiveSummary = "Your personalized risk snapshot digest is ready.",
  items = [],
  primaryCtaUrl = `${BASE_URL}/docs`,
  primaryCtaLabel = "Open interactive snapshots",
  decomposeDocsUrl = `${BASE_URL}/docs`,
  apiExampleCaption = "Try the decompose API",
  apiExampleCode = `curl -s "${BASE_URL}/api/decompose?ticker=NVDA" \\
  -H "Authorization: Bearer $RISKMODELS_API_KEY"`,
}: SnapshotDigestEmailProps) => {
  const issueLabel = issueLabelProp?.trim() || periodLabel;
  return (
  <Html>
    <Head />
    <Preview>{`RiskModels — snapshot digest · ${issueLabel}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img src={LOGO_URL} width="48" height="48" alt="RiskModels" style={logo} />
        <Heading style={heading}>Snapshot digest</Heading>
        <Text style={issueKicker}>{issueLabel}</Text>

        <Text style={paragraph}>Hi {userName},</Text>

        <Section style={summaryBox}>
          <Text style={summaryText}>{executiveSummary}</Text>
        </Section>

        {items.length > 0 ? (
          <>
            <Heading as="h2" style={subheading}>
              In this issue
            </Heading>
            <Section style={listSection}>
              {items.map((item, index) => {
                const tag = item.reportId?.trim();
                const linkLabel = tag ? `${item.label} · ${tag}` : item.label;
                return (
                  <Text key={`${item.label}-${index}`} style={bulletLine}>
                    <span style={bulletMark}>{"\u2022"}</span>
                    <Link href={item.interactiveUrl} style={bulletLink}>
                      {linkLabel}
                    </Link>
                    <span style={highlightInline}> — {item.highlight}</span>
                  </Text>
                );
              })}
            </Section>

            <Heading as="h2" style={subheading}>
              Open snapshots
            </Heading>
            {items.map((item, index) => (
              <Section key={`detail-${item.label}-${index}`} style={itemBox}>
                <Text style={itemKind}>
                  {item.kind === "fund" ? "Fund" : "Stock"}
                  {item.reportId ? ` · ${item.reportId}` : ""} · {item.label}
                </Text>
                <Text style={itemTeaser}>{item.highlight}</Text>
                <Link href={item.interactiveUrl} style={itemLink}>
                  View interactive snapshot
                </Link>
              </Section>
            ))}
          </>
        ) : null}

        <Section style={buttonContainer}>
          <Button style={button} href={primaryCtaUrl}>
            {primaryCtaLabel}
          </Button>
        </Section>

        <Hr style={hr} />

        <Heading as="h2" style={subheading}>
          Agentic upgrade
        </Heading>
        <Text style={paragraph}>
          Want this in real time inside Cursor, Claude, or your Python stack? Use the
          decomposition API and MCP tools — same data as these PDFs, wired for agents.
        </Text>
        <Text style={paragraph}>
          <Link href={decomposeDocsUrl} style={link}>
            {apiExampleCaption}
          </Link>
        </Text>
        <Section style={codeBlock}>
          <Text style={codeText}>{apiExampleCode}</Text>
        </Section>

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
};

export default SnapshotDigestEmail;

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
  margin: "0 0 4px",
};

const issueKicker = {
  color: "#a1a1aa",
  fontSize: "14px",
  lineHeight: "1.4",
  margin: "0 0 18px",
};

const subheading = {
  color: "#e4e4e7",
  fontSize: "17px",
  fontWeight: "600",
  lineHeight: "1.35",
  margin: "0 0 12px",
};

const paragraph = {
  color: "#a1a1aa",
  fontSize: "15px",
  lineHeight: "1.6",
  margin: "0 0 16px",
};

const summaryBox = {
  backgroundColor: "#18181b",
  borderRadius: "8px",
  border: "1px solid #3f3f46",
  padding: "14px 16px",
  margin: "0 0 22px",
};

const summaryText = {
  color: "#e4e4e7",
  fontSize: "15px",
  lineHeight: "1.55",
  margin: "0",
};

const listSection = {
  margin: "0 0 20px",
};

const bulletLine = {
  color: "#d4d4d8",
  fontSize: "14px",
  lineHeight: "1.55",
  margin: "0 0 10px",
};

const bulletMark = {
  color: "#71717a",
  marginRight: "6px",
};

const bulletLink = {
  color: "#60a5fa",
  fontSize: "14px",
  textDecoration: "underline",
};

const highlightInline = {
  color: "#d4d4d8",
  fontSize: "14px",
};

const itemBox = {
  borderLeft: "3px solid #2563eb",
  paddingLeft: "14px",
  margin: "0 0 16px",
};

const itemKind = {
  color: "#71717a",
  fontSize: "12px",
  textTransform: "uppercase" as const,
  letterSpacing: "0.04em",
  margin: "0 0 6px",
};

const itemTeaser = {
  color: "#d4d4d8",
  fontSize: "14px",
  lineHeight: "1.55",
  margin: "0 0 8px",
};

const itemLink = {
  color: "#60a5fa",
  fontSize: "14px",
  textDecoration: "underline",
};

const buttonContainer = { textAlign: "center" as const, margin: "24px 0" };

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

const codeBlock = {
  backgroundColor: "#18181b",
  borderRadius: "8px",
  border: "1px solid #3f3f46",
  padding: "12px 14px",
  margin: "0 0 16px",
};

const codeText = {
  color: "#e4e4e7",
  fontFamily: 'ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace',
  fontSize: "12px",
  lineHeight: "1.5",
  margin: "0",
  whiteSpace: "pre-wrap" as const,
};

const small = { color: "#71717a", fontSize: "12px", lineHeight: "1.5", margin: "0" };

const link = { color: "#60a5fa", textDecoration: "underline" };
