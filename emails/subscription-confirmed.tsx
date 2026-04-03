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
} from '@react-email/components';
import * as React from 'react';
import { BASE_URL, LOGO_URL } from './constants';

interface SubscriptionConfirmedEmailProps {
  userName: string;
  tier: string;
  amount: number;
  nextBillingDate: string;
  invoiceUrl: string;
}

export const SubscriptionConfirmedEmail = ({
  userName = 'there',
  tier = 'Professional',
  amount = 49,
  nextBillingDate = 'January 1, 2025',
  invoiceUrl = `${BASE_URL}/settings`,
}: SubscriptionConfirmedEmailProps) => (
  <Html>
    <Head />
    <Preview>Welcome to RiskModels {tier} - Subscription Confirmed</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img
          src={LOGO_URL}
          width="48"
          height="48"
          alt="RiskModels"
          style={logo}
        />
        <Heading style={heading}>Subscription Confirmed!</Heading>
        
        <Text style={paragraph}>
          Hi {userName},
        </Text>

        <Text style={paragraph}>
          Thank you for upgrading to <strong>RiskModels {tier}</strong>. Your payment has been 
          processed successfully.
        </Text>

        <Section style={receiptContainer}>
          <Text style={receiptTitle}>Payment Receipt</Text>
          <Hr style={receiptDivider} />
          <table style={receiptTable}>
            <tr>
              <td style={receiptLabel}>Plan:</td>
              <td style={receiptValue}>RiskModels {tier}</td>
            </tr>
            <tr>
              <td style={receiptLabel}>Amount:</td>
              <td style={receiptValue}>${amount.toFixed(2)}</td>
            </tr>
            <tr>
              <td style={receiptLabel}>Next Billing:</td>
              <td style={receiptValue}>{nextBillingDate}</td>
            </tr>
          </table>
          <Hr style={receiptDivider} />
          <Section style={buttonContainer}>
            <Button style={smallButton} href={invoiceUrl}>
              Download Invoice
            </Button>
          </Section>
        </Section>

        <Hr style={hr} />

        <Heading as="h2" style={subheading}>
          You Now Have Access To:
        </Heading>

        <Text style={paragraph}>
          ✓ <strong>Unlimited Portfolio Analysis</strong> - Track all your investment accounts<br />
          ✓ <strong>Advanced Hedge Strategies</strong> - L2 sector and L3 subsector protection<br />
          ✓ <strong>PDF Risk Reports</strong> - Up to 50 professional reports per month<br />
          ✓ <strong>Real-time Alerts</strong> - Portfolio risk notifications<br />
          ✓ <strong>5-Year Historical Data</strong> - Deep factor analysis<br />
          ✓ <strong>Priority Support</strong> - Email and chat assistance
        </Text>

        <Section style={buttonContainer}>
          <Button style={button} href={`${BASE_URL}/settings`}>
            Go to Dashboard
          </Button>
        </Section>

        <Hr style={hr} />

        <Text style={paragraph}>
          Questions about your subscription? Visit{' '}
          <Link href={`${BASE_URL}/settings`} style={link}>
            Account Settings
          </Link>{' '}
          or reply to this email.
        </Text>

        <Text style={footer}>
          RiskModels - Institutional Risk Management for Individual Investors<br />
          <Link href={BASE_URL} style={footerLink}>
            riskmodels.app
          </Link>
        </Text>
      </Container>
    </Body>
  </Html>
);

export default SubscriptionConfirmedEmail;

const main = {
  backgroundColor: '#f6f9fc',
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '20px 0 48px',
  marginBottom: '64px',
};

const logo = {
  margin: '0 auto',
  display: 'block',
};

const heading = {
  fontSize: '32px',
  lineHeight: '1.3',
  fontWeight: '700',
  color: '#10b981',
  textAlign: 'center' as const,
  margin: '30px 0',
};

const subheading = {
  fontSize: '21px',
  lineHeight: '1.4',
  fontWeight: '600',
  color: '#1a1a1a',
  margin: '20px 0 10px',
};

const paragraph = {
  fontSize: '16px',
  lineHeight: '1.6',
  color: '#4a5568',
  margin: '16px 0',
  padding: '0 20px',
};

const receiptContainer = {
  backgroundColor: '#f7fafc',
  borderRadius: '8px',
  padding: '24px',
  margin: '24px 20px',
  border: '1px solid #e2e8f0',
};

const receiptTitle = {
  fontSize: '18px',
  fontWeight: '600',
  color: '#2d3748',
  textAlign: 'center' as const,
  marginBottom: '16px',
};

const receiptDivider = {
  borderColor: '#cbd5e0',
  margin: '16px 0',
};

const receiptTable = {
  width: '100%',
  fontSize: '15px',
};

const receiptLabel = {
  color: '#718096',
  padding: '8px 0',
};

const receiptValue = {
  color: '#2d3748',
  fontWeight: '600',
  textAlign: 'right' as const,
  padding: '8px 0',
};

const buttonContainer = {
  textAlign: 'center' as const,
  margin: '24px 0',
};

const button = {
  backgroundColor: '#3b82f6',
  borderRadius: '5px',
  color: '#fff',
  fontSize: '16px',
  fontWeight: 'bold',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '14px 32px',
};

const smallButton = {
  backgroundColor: '#ffffff',
  border: '1px solid #cbd5e0',
  borderRadius: '5px',
  color: '#3b82f6',
  fontSize: '14px',
  fontWeight: '600',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '10px 24px',
};

const hr = {
  borderColor: '#e2e8f0',
  margin: '32px 0',
};

const link = {
  color: '#3b82f6',
  textDecoration: 'underline',
};

const footer = {
  color: '#8898aa',
  fontSize: '14px',
  lineHeight: '24px',
  textAlign: 'center' as const,
  padding: '0 20px',
  margin: '32px 0 0',
};

const footerLink = {
  color: '#8898aa',
  textDecoration: 'underline',
};

