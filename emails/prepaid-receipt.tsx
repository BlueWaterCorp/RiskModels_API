import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";
import {
  API_TERMS_URL,
  BASE_URL,
  LEGAL_ENTITY,
  LOGO_PNG_URL,
  SUPPORT_EMAIL,
} from "./constants";

/**
 * Receipt for a prepaid API-credit purchase (Stripe Checkout, payment mode).
 *
 * Sent once per PaymentIntent from the crediting handler
 * (`/api/stripe/setup-success`) right after the balance is credited, and on
 * demand from `/api/admin/billing/receipt` for backfills. Laid out as a
 * document rather than a notification: issuer / billed-to blocks, a line-item
 * table with totals, the payment record, and the account effect. Stripe's
 * hosted receipt (card details, tax lines) is linked rather than duplicated.
 */
export interface PrepaidReceiptEmailProps {
  /** Deterministic per PaymentIntent, e.g. RM-20260916-PLCDBA. */
  receiptNumber: string;
  /** Payment date, already formatted (e.g. "September 16, 2026"). */
  paidAtFormatted: string;
  /** Billing name from the card, when Stripe has one. */
  billedToName?: string;
  billedToEmail: string;
  /** Amount charged, USD. */
  amountUsd: number;
  /** Tax collected, USD — shown as its own line only when known. */
  taxUsd?: number;
  /** Balance after the credit was applied, USD. */
  newBalanceUsd: number;
  /** Stripe PaymentIntent id — the reference support asks for. */
  paymentIntentId: string;
  /** "Visa •••• 4242", "Link", … — omitted when Stripe did not expose it. */
  paymentMethodLabel?: string;
  /** Stripe hosted receipt (pay.stripe.com/receipts/…). */
  receiptUrl?: string;
  /** Where to top up / manage the balance. */
  balanceUrl: string;
}

const fmtUsd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const PrepaidReceiptEmail = ({
  receiptNumber = "RM-20260916-000000",
  paidAtFormatted = "September 16, 2026",
  billedToName,
  billedToEmail = "developer@example.com",
  amountUsd = 100,
  taxUsd,
  newBalanceUsd = 120,
  paymentIntentId = "pi_…",
  paymentMethodLabel,
  receiptUrl,
  balanceUrl = `${BASE_URL}/get-key`,
}: PrepaidReceiptEmailProps) => {
  const subtotal = taxUsd !== undefined ? amountUsd - taxUsd : amountUsd;
  return (
    <Html>
      <Head />
      <Preview>
        {`Receipt ${receiptNumber} — ${fmtUsd(amountUsd)} RiskModels API credit`}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          {/* ── Masthead ─────────────────────────────────────────────── */}
          <Section style={masthead}>
            <Row>
              <Column style={mastLeft}>
                <Img src={LOGO_PNG_URL} width="150" height="88" alt="RiskModels" style={logo} />
                <Text style={wordmark}>RiskModels</Text>
                <Text style={wordmarkSub}>Institutional Risk Analysis via API</Text>
              </Column>
              <Column style={mastRight}>
                <Text style={docTitle}>RECEIPT</Text>
                <Text style={docMeta}>
                  <span style={docMetaLabel}>No.</span> {receiptNumber}
                </Text>
                <Text style={docMeta}>
                  <span style={docMetaLabel}>Date</span> {paidAtFormatted}
                </Text>
                <Text style={paidPill}>PAID</Text>
              </Column>
            </Row>
          </Section>

          {/* ── Parties ──────────────────────────────────────────────── */}
          <Section style={parties}>
            <Row>
              <Column style={partyCol}>
                <Text style={partyLabel}>Issued by</Text>
                <Text style={partyText}>
                  <strong style={partyStrong}>{LEGAL_ENTITY}</strong>
                  <br />
                  RiskModels
                  <br />
                  <Link href={BASE_URL} style={partyLink}>
                    {BASE_URL.replace(/^https?:\/\//, "")}
                  </Link>
                  <br />
                  <Link href={`mailto:${SUPPORT_EMAIL}`} style={partyLink}>
                    {SUPPORT_EMAIL}
                  </Link>
                </Text>
              </Column>
              <Column style={partyCol}>
                <Text style={partyLabel}>Billed to</Text>
                <Text style={partyText}>
                  {billedToName ? (
                    <>
                      <strong style={partyStrong}>{billedToName}</strong>
                      <br />
                    </>
                  ) : null}
                  {billedToEmail}
                </Text>
              </Column>
            </Row>
          </Section>

          {/* ── Line items ───────────────────────────────────────────── */}
          <Section style={itemsWrap}>
            <table style={itemsTable} cellPadding={0} cellSpacing={0} role="presentation">
              <thead>
                <tr>
                  <th style={th}>Description</th>
                  <th style={thNum}>Qty</th>
                  <th style={thNum}>Unit price</th>
                  <th style={thNum}>Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={td}>
                    <span style={tdStrong}>Prepaid API credit</span>
                    <br />
                    <span style={tdMuted}>
                      Applied to your riskmodels.app API balance; drawn down per request at
                      published rates.
                    </span>
                  </td>
                  <td style={tdNum}>1</td>
                  <td style={tdNum}>{fmtUsd(subtotal)}</td>
                  <td style={tdNum}>{fmtUsd(subtotal)}</td>
                </tr>
                {taxUsd !== undefined ? (
                  <>
                    <tr>
                      <td style={totalsLabel} colSpan={3}>
                        Subtotal
                      </td>
                      <td style={totalsValue}>{fmtUsd(subtotal)}</td>
                    </tr>
                    <tr>
                      <td style={totalsLabel} colSpan={3}>
                        Tax
                      </td>
                      <td style={totalsValue}>{fmtUsd(taxUsd)}</td>
                    </tr>
                  </>
                ) : null}
                <tr>
                  <td style={grandLabel} colSpan={3}>
                    Total paid (USD)
                  </td>
                  <td style={grandValue}>{fmtUsd(amountUsd)}</td>
                </tr>
              </tbody>
            </table>
          </Section>

          {/* ── Payment record ───────────────────────────────────────── */}
          <Section style={recordWrap}>
            <table style={recordTable} cellPadding={0} cellSpacing={0} role="presentation">
              <tbody>
                <tr>
                  <td style={recordLabel}>Payment date</td>
                  <td style={recordValue}>{paidAtFormatted}</td>
                </tr>
                {paymentMethodLabel ? (
                  <tr>
                    <td style={recordLabel}>Payment method</td>
                    <td style={recordValue}>{paymentMethodLabel}</td>
                  </tr>
                ) : null}
                <tr>
                  <td style={recordLabel}>Processor</td>
                  <td style={recordValue}>Stripe</td>
                </tr>
                <tr>
                  <td style={recordLabel}>Transaction reference</td>
                  <td style={recordValue}>
                    <code style={inlineCode}>{paymentIntentId}</code>
                  </td>
                </tr>
                <tr>
                  <td style={recordLabelLast}>Balance after credit</td>
                  <td style={recordValueLastStrong}>{fmtUsd(newBalanceUsd)}</td>
                </tr>
              </tbody>
            </table>
          </Section>

          {/* ── Actions ──────────────────────────────────────────────── */}
          <Section style={actions}>
            {receiptUrl ? (
              <Button style={buttonPrimary} href={receiptUrl}>
                View Stripe receipt
              </Button>
            ) : null}
            <Button style={buttonSecondary} href={balanceUrl}>
              Manage balance
            </Button>
          </Section>
          {receiptUrl ? (
            <Text style={smallCenter}>
              The Stripe receipt carries the card details and any tax lines. Keep it with this
              document for your records.
            </Text>
          ) : null}

          {/* ── Footer ───────────────────────────────────────────────── */}
          <Section style={footerRuleWrap}>
            <Hr style={footerRule} />
          </Section>
          <Text style={footerText}>
            RiskModels is operated by {LEGAL_ENTITY} Prepaid credit is applied to API usage at
            the{" "}
            <Link href={`${BASE_URL}/pricing`} style={footerLink}>
              published rates
            </Link>{" "}
            and is non-refundable except as required by law, per the{" "}
            <Link href={API_TERMS_URL} style={footerLink}>
              API Terms
            </Link>
            . For a receipt in a different billing name, or any question about this charge,
            reply to this email or write to{" "}
            <Link href={`mailto:${SUPPORT_EMAIL}`} style={footerLink}>
              {SUPPORT_EMAIL}
            </Link>{" "}
            quoting receipt no. {receiptNumber}.
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export default PrepaidReceiptEmail;

// ── Palette: Consultant Navy, mirrored from the snapshot THEME ────────────────
const NAVY = "#002a5e";
const INK = "#1a1a1a";
const BODY = "#4a5568";
const MUTED = "#64748b";
const RULE = "#e2e8f0";
const PANEL = "#f8fafc";
const GREEN = "#00AA00";

const main = {
  backgroundColor: "#f6f9fc",
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
  padding: "24px 0",
};

const container = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  padding: "0 0 32px",
  maxWidth: "640px",
  borderTop: `6px solid ${NAVY}`,
};

const masthead = { padding: "28px 32px 20px" };
const mastLeft = { width: "58%", verticalAlign: "top" as const };
const mastRight = { width: "42%", verticalAlign: "top" as const, textAlign: "right" as const };

const logo = { display: "block" as const, margin: "0 0 4px -10px" };

const wordmark = {
  color: NAVY,
  fontSize: "22px",
  fontWeight: "700",
  letterSpacing: "-0.01em",
  lineHeight: "1.2",
  margin: "0",
};

const wordmarkSub = {
  color: MUTED,
  fontSize: "12px",
  lineHeight: "1.4",
  margin: "2px 0 0",
};

const docTitle = {
  color: NAVY,
  fontSize: "26px",
  fontWeight: "700",
  letterSpacing: "0.18em",
  lineHeight: "1.1",
  margin: "4px 0 10px",
};

const docMeta = {
  color: BODY,
  fontSize: "13px",
  lineHeight: "1.5",
  margin: "0 0 2px",
};

const docMetaLabel = { color: MUTED, fontSize: "11px", letterSpacing: "0.08em", marginRight: "6px" };

const paidPill = {
  display: "inline-block" as const,
  backgroundColor: "#e8f7e8",
  color: GREEN,
  border: `1px solid ${GREEN}`,
  borderRadius: "4px",
  fontSize: "11px",
  fontWeight: "700",
  letterSpacing: "0.14em",
  lineHeight: "1",
  padding: "6px 10px",
  margin: "10px 0 0",
};

const parties = {
  padding: "18px 32px",
  borderTop: `1px solid ${RULE}`,
  borderBottom: `1px solid ${RULE}`,
  backgroundColor: PANEL,
};
const partyCol = { width: "50%", verticalAlign: "top" as const };
const partyLabel = {
  color: MUTED,
  fontSize: "11px",
  fontWeight: "600",
  letterSpacing: "0.1em",
  textTransform: "uppercase" as const,
  margin: "0 0 6px",
};
const partyText = { color: BODY, fontSize: "13px", lineHeight: "1.55", margin: "0" };
const partyStrong = { color: INK, fontWeight: "600" };
const partyLink = { color: BODY, textDecoration: "none" };

const itemsWrap = { padding: "24px 32px 8px" };
const itemsTable = { width: "100%", borderCollapse: "collapse" as const };
const th = {
  textAlign: "left" as const,
  padding: "10px 12px",
  backgroundColor: NAVY,
  color: "#ffffff",
  fontSize: "11px",
  fontWeight: "600",
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
};
const thNum = { ...th, textAlign: "right" as const, whiteSpace: "nowrap" as const };
const td = {
  verticalAlign: "top" as const,
  padding: "14px 12px",
  color: BODY,
  fontSize: "13px",
  lineHeight: "1.55",
  borderBottom: `1px solid ${RULE}`,
};
const tdNum = { ...td, textAlign: "right" as const, whiteSpace: "nowrap" as const };
const tdStrong = { color: INK, fontWeight: "600" };
const tdMuted = { color: MUTED, fontSize: "12px" };
const totalsLabel = {
  padding: "8px 12px",
  textAlign: "right" as const,
  color: MUTED,
  fontSize: "13px",
};
const totalsValue = { ...totalsLabel, color: BODY, whiteSpace: "nowrap" as const };
const grandLabel = {
  padding: "12px 12px",
  textAlign: "right" as const,
  color: INK,
  fontSize: "14px",
  fontWeight: "700",
  borderTop: `2px solid ${NAVY}`,
};
const grandValue = { ...grandLabel, whiteSpace: "nowrap" as const };

const recordWrap = { padding: "8px 32px 4px" };
const recordTable = {
  width: "100%",
  borderCollapse: "collapse" as const,
  border: `1px solid ${RULE}`,
};
const recordLabel = {
  width: "40%",
  padding: "9px 12px",
  backgroundColor: PANEL,
  color: MUTED,
  fontSize: "12px",
  borderBottom: `1px solid ${RULE}`,
};
const recordValue = {
  padding: "9px 12px",
  color: BODY,
  fontSize: "13px",
  borderBottom: `1px solid ${RULE}`,
};
const recordLabelLast = { ...recordLabel, borderBottom: "none" };
const recordValueLastStrong = {
  ...recordValue,
  borderBottom: "none",
  color: INK,
  fontWeight: "700",
};

const inlineCode = {
  backgroundColor: PANEL,
  padding: "2px 6px",
  borderRadius: "3px",
  fontSize: "12px",
  color: INK,
};

const actions = { padding: "20px 32px 4px", textAlign: "center" as const };

const buttonPrimary = {
  backgroundColor: NAVY,
  borderRadius: "4px",
  color: "#ffffff",
  fontSize: "13px",
  fontWeight: "600",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "11px 20px",
  margin: "0 6px 8px",
};

const buttonSecondary = {
  ...buttonPrimary,
  backgroundColor: "#ffffff",
  color: NAVY,
  border: `1px solid ${NAVY}`,
};

const smallCenter = {
  color: MUTED,
  fontSize: "12px",
  lineHeight: "1.5",
  textAlign: "center" as const,
  margin: "0",
  padding: "0 32px",
};

const footerRuleWrap = { padding: "24px 32px 0" };
const footerRule = { borderColor: RULE, margin: "0" };

const footerText = {
  color: MUTED,
  fontSize: "11px",
  lineHeight: "1.6",
  margin: "14px 0 0",
  padding: "0 32px",
};

const footerLink = { color: MUTED, textDecoration: "underline" };
