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

/**
 * Receipt for a prepaid API-credit purchase (Stripe Checkout, payment mode).
 *
 * Sent once per PaymentIntent from the crediting handler
 * (`/api/stripe/setup-success`) right after the balance is credited, and on
 * demand from `/api/admin/billing/receipt` for backfills. Stripe's own hosted
 * receipt (legal entity, card details, tax lines) is linked rather than
 * duplicated; this mail is the account-side confirmation: what was paid, what
 * it bought, and the resulting balance.
 */
export interface PrepaidReceiptEmailProps {
  /** Display name (agent_name / email local-part). */
  firstName: string;
  /** Amount charged, USD. */
  amountUsd: number;
  /** Balance after the credit was applied, USD. */
  newBalanceUsd: number;
  /** Stripe PaymentIntent id — the customer-facing reference for support. */
  paymentIntentId: string;
  /** Payment date, already formatted (e.g. "September 16, 2026"). */
  paidAtFormatted: string;
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
  firstName = "Developer",
  amountUsd = 100,
  newBalanceUsd = 120,
  paymentIntentId = "pi_…",
  paidAtFormatted = "September 16, 2026",
  paymentMethodLabel,
  receiptUrl,
  balanceUrl = `${BASE_URL}/get-key`,
}: PrepaidReceiptEmailProps) => (
  <Html>
    <Head />
    <Preview>
      {`Receipt: ${fmtUsd(amountUsd)} of RiskModels API credit — balance now ${fmtUsd(newBalanceUsd)}`}
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Img src={LOGO_URL} width="48" height="48" alt="RiskModels" style={logo} />
        <Heading style={heading}>Receipt — RiskModels API credit</Heading>

        <Text style={paragraph}>Hi {firstName},</Text>

        <Text style={paragraph}>
          Thanks — your payment of <strong>{fmtUsd(amountUsd)}</strong> was
          received and added to your RiskModels API balance.
        </Text>

        <Section style={tableWrap}>
          <table style={dataTable} cellPadding={0} cellSpacing={0} role="presentation">
            <tbody>
              <tr>
                <td style={tdLabel}>Date</td>
                <td style={td}>{paidAtFormatted}</td>
              </tr>
              <tr>
                <td style={tdLabel}>Item</td>
                <td style={td}>Prepaid API credit</td>
              </tr>
              <tr>
                <td style={tdLabel}>Amount paid</td>
                <td style={tdStrong}>{fmtUsd(amountUsd)}</td>
              </tr>
              {paymentMethodLabel ? (
                <tr>
                  <td style={tdLabel}>Payment method</td>
                  <td style={td}>{paymentMethodLabel}</td>
                </tr>
              ) : null}
              <tr>
                <td style={tdLabel}>Balance after credit</td>
                <td style={tdStrong}>{fmtUsd(newBalanceUsd)}</td>
              </tr>
              <tr>
                <td style={tdLabelLast}>Reference</td>
                <td style={tdLast}>
                  <code style={inlineCode}>{paymentIntentId}</code>
                </td>
              </tr>
            </tbody>
          </table>
        </Section>

        {receiptUrl ? (
          <Section style={buttonContainer}>
            <Button style={button} href={receiptUrl}>
              View Stripe receipt
            </Button>
            <Text style={small}>
              Card details, billing name and the itemised receipt are on the
              Stripe page — keep that link for your records.
            </Text>
          </Section>
        ) : null}

        <Text style={paragraph}>
          Credit is drawn down per request at the published{" "}
          <Link href={`${BASE_URL}/pricing`} style={link}>
            API rates
          </Link>
          . You can check your balance and add more credit at any time from{" "}
          <Link href={balanceUrl} style={link}>
            {balanceUrl.replace(/^https?:\/\//, "")}
          </Link>
          .
        </Text>

        <Hr style={hr} />

        <Text style={paragraph}>
          Need an invoice with a different billing name or address, or have a
          question about this charge? Reply to this email or write to{" "}
          <Link href={`mailto:${SUPPORT_EMAIL}`} style={link}>
            {SUPPORT_EMAIL}
          </Link>{" "}
          quoting the reference above.
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

export default PrepaidReceiptEmail;

const main = {
  backgroundColor: "#f6f9fc",
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  padding: "32px 24px 48px",
  maxWidth: "600px",
};

const logo = { margin: "0 auto 16px", display: "block" as const };

const heading = {
  color: "#1a1a1a",
  fontSize: "20px",
  fontWeight: "600",
  lineHeight: "1.35",
  margin: "0 0 20px",
};

const paragraph = {
  color: "#4a5568",
  fontSize: "14px",
  lineHeight: "1.65",
  margin: "0 0 14px",
};

const tableWrap = { margin: "8px 0 20px" };

const dataTable = {
  width: "100%",
  borderCollapse: "collapse" as const,
  border: "1px solid #e2e8f0",
  borderRadius: "8px",
  overflow: "hidden" as const,
};

const td = {
  verticalAlign: "top" as const,
  padding: "10px 12px",
  color: "#4a5568",
  fontSize: "13px",
  lineHeight: "1.55",
  borderBottom: "1px solid #e2e8f0",
};

const tdLabel = {
  ...td,
  width: "38%",
  backgroundColor: "#f8fafc",
  color: "#374151",
  fontWeight: "500",
};

const tdStrong = { ...td, color: "#1e293b", fontWeight: "600" };

const tdLast = { ...td, borderBottom: "none" };
const tdLabelLast = { ...tdLabel, borderBottom: "none" };

const hr = { borderColor: "#e2e8f0", margin: "28px 0" };

const buttonContainer = { textAlign: "center" as const, margin: "8px 0 24px" };

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

const small = {
  color: "#64748b",
  fontSize: "12px",
  lineHeight: "1.5",
  margin: "12px 0 0",
};

const link = { color: "#2563eb", textDecoration: "underline" };

const inlineCode = {
  backgroundColor: "#f1f5f9",
  padding: "2px 6px",
  borderRadius: "4px",
  fontSize: "12px",
  color: "#1e293b",
};

const footer = {
  color: "#8898aa",
  fontSize: "13px",
  lineHeight: "22px",
  textAlign: "center" as const,
  margin: "32px 0 0",
};

const footerLink = { color: "#8898aa", textDecoration: "underline" };
