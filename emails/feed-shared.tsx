import { Hr, Img, Link, Section, Text } from "@react-email/components";
import * as React from "react";
import { BASE_URL, LEGAL_ENTITY, LEGAL_MAILING_ADDRESS, SUPPORT_EMAIL } from "./constants";
import { FEED_DESCRIPTOR_URL, feedDescriptorJson, type FeedDescriptorOptions } from "../lib/feed-descriptor";

/**
 * Shared pieces for the security master feed emails (early access, launch
 * notice, personal invite): header, the "how it fits" section, the feedback
 * ask, the machine-readable block, and the footer. Copy that is common to all
 * three lives here so it cannot drift.
 */

/** Horizontal logo: wave and wordmark on one line. Hosted in /public; Gmail strips SVG, so PNG. */
export const FEED_LOGO_URL = `${BASE_URL}/riskmodels-logo-horizontal.png`;

export const FeedHeader = ({ logoSrc = FEED_LOGO_URL }: { logoSrc?: string }) => (
  <Img src={logoSrc} width="240" height="38" alt="RiskModels" style={styles.logo} />
);

/** Why a team would run the feed next to what it already has. No vendor is named. */
export const FEED_FIT_INTRO =
  "Commercial risk platforms and data terminals, and in-house security master processes, already track identity changes. The feed does not replace them. It gives you an independent record to check them against:";

export const FEED_FIT_POINTS: ReadonlyArray<{ lead: string; text: string }> = [
  {
    lead: "Reconcile.",
    text: "Compare each day's events with your own master and find a change you missed or recorded late.",
  },
  {
    lead: "Settle disagreements.",
    text: "Every event cites the SEC filing behind it, so you can read the source instead of choosing between two systems.",
  },
  {
    lead: "Keep history honest.",
    text: "Corrections arrive with the old value, the new value and the reason, and every fact carries the date it became known.",
  },
  {
    lead: "Join without friction.",
    text: "Securities are keyed on FIGI, CIK, ticker and the RiskModels id, which you can join to your own master on.",
  },
];

export const FeedFit = () => (
  <Section style={styles.fitBox}>
    <Text style={styles.boxHeading}>How it fits with what you already use</Text>
    <Text style={styles.boxText}>{FEED_FIT_INTRO}</Text>
    {FEED_FIT_POINTS.map((p, i) => (
      <Text key={p.lead} style={i === FEED_FIT_POINTS.length - 1 ? styles.boxTextLast : styles.bullet}>
        <strong>{p.lead}</strong> {p.text}
      </Text>
    ))}
  </Section>
);

export const FeedFeedbackAsk = ({ heading, lines }: { heading: string; lines: readonly string[] }) => (
  <Section style={styles.feedbackBox}>
    <Text style={styles.boxHeading}>{heading}</Text>
    {lines.map((l, i) => (
      <Text key={l} style={i === lines.length - 1 ? styles.boxTextLast : styles.boxText}>
        {l}
      </Text>
    ))}
  </Section>
);

/**
 * Machine-readable block. A person can ignore it. Saved to a folder with the
 * message, it lets an agent decide later whether the feed helps a process the
 * recipient runs. The always-current copy is at FEED_DESCRIPTOR_URL.
 */
export const FeedAgentBlock = ({ descriptor }: { descriptor?: FeedDescriptorOptions }) => (
  <Section style={styles.agentBox}>
    <Text style={styles.agentHeading}>For agents and automation</Text>
    <Text style={styles.agentText}>
      You can ignore this block. Save this email to a folder and an agent can read the JSON below to judge
      whether the feed helps a process you run. The current version is at{" "}
      <Link href={FEED_DESCRIPTOR_URL} style={styles.link}>
        {FEED_DESCRIPTOR_URL}
      </Link>
      .
    </Text>
    <pre style={styles.pre}>{feedDescriptorJson(descriptor)}</pre>
  </Section>
);

export const FeedFooter = ({ reason, unsubscribeUrl }: { reason: string; unsubscribeUrl: string }) => (
  <>
    <Hr style={styles.hr} />
    <Text style={styles.small}>
      {reason}{" "}
      <Link href={unsubscribeUrl} style={styles.link}>
        Unsubscribe
      </Link>
      {" · "}
      <Link href={`mailto:${SUPPORT_EMAIL}`} style={styles.link}>
        {SUPPORT_EMAIL}
      </Link>
    </Text>
    <Text style={styles.small}>
      RiskModels is a registered DBA of {LEGAL_ENTITY}, {LEGAL_MAILING_ADDRESS}. Historical, end-of-day
      data. Not investment advice.
    </Text>
  </>
);

export const styles = {
  main: {
    backgroundColor: "#f6f9fc",
    fontFamily:
      '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
  },
  container: { backgroundColor: "#ffffff", margin: "0 auto", padding: "28px 24px 40px", maxWidth: "560px" },
  logo: { margin: "0 0 22px", display: "block" as const },
  heading: { color: "#002a5e", fontSize: "22px", fontWeight: "600", lineHeight: "1.3", margin: "0 0 16px" },
  paragraph: { color: "#334155", fontSize: "15px", lineHeight: "1.6", margin: "0 0 16px" },
  banner: {
    backgroundColor: "#f5f7fb",
    borderLeft: "3px solid #002a5e",
    color: "#1f2937",
    fontSize: "15px",
    lineHeight: "1.55",
    padding: "10px 14px",
    margin: "0 0 20px",
  },
  box: {
    backgroundColor: "#f5f7fb",
    borderRadius: "6px",
    border: "1px solid #e2e8f0",
    padding: "14px 16px",
    margin: "0 0 20px",
  },
  fitBox: {
    backgroundColor: "#f5f7fb",
    borderRadius: "6px",
    border: "1px solid #e2e8f0",
    padding: "14px 16px",
    margin: "0 0 20px",
  },
  feedbackBox: {
    backgroundColor: "#ffffff",
    borderRadius: "6px",
    border: "1px solid #002a5e",
    padding: "14px 16px",
    margin: "0 0 20px",
  },
  boxHeading: { color: "#002a5e", fontSize: "14px", fontWeight: "600", margin: "0 0 8px" },
  boxText: { color: "#1f2937", fontSize: "14px", lineHeight: "1.55", margin: "0 0 8px" },
  bullet: { color: "#1f2937", fontSize: "14px", lineHeight: "1.55", margin: "0 0 8px", paddingLeft: "12px" },
  boxTextLast: { color: "#1f2937", fontSize: "14px", lineHeight: "1.55", margin: "0", paddingLeft: "12px" },
  buttonWrap: { margin: "4px 0 20px" },
  button: {
    backgroundColor: "#002a5e",
    borderRadius: "4px",
    color: "#ffffff",
    fontSize: "15px",
    fontWeight: "600",
    textDecoration: "none",
    padding: "12px 20px",
    display: "inline-block" as const,
  },
  agentBox: {
    backgroundColor: "#f8fafc",
    borderRadius: "6px",
    border: "1px dashed #cbd5e1",
    padding: "12px 14px",
    margin: "0 0 20px",
  },
  agentHeading: { color: "#475569", fontSize: "12px", fontWeight: "600", margin: "0 0 6px" },
  agentText: { color: "#64748b", fontSize: "12px", lineHeight: "1.5", margin: "0 0 8px" },
  pre: {
    color: "#334155",
    fontFamily: '"SFMono-Regular",Menlo,Consolas,monospace',
    fontSize: "11px",
    lineHeight: "1.45",
    margin: "0",
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
  },
  link: { color: "#0369a1", textDecoration: "underline" },
  hr: { borderColor: "#e2e8f0", margin: "24px 0 16px" },
  small: { color: "#64748b", fontSize: "12px", lineHeight: "1.5", margin: "0 0 8px" },
};
