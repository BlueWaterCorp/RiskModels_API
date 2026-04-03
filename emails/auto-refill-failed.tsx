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

interface AutoRefillFailedEmailProps {
  userName: string;
  errorMessage: string;
  balanceUsd: number;
  updatePaymentUrl: string;
}

export const AutoRefillFailedEmail = ({
  userName = 'Developer',
  errorMessage = 'Payment method declined',
  balanceUsd = 2.5,
  updatePaymentUrl = `${BASE_URL}/settings?tab=billing`,
}: AutoRefillFailedEmailProps) => (
  <Html>
    <Head />
    <Preview>Action Required: Your RiskModels Auto-Refill Failed</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img
          src={LOGO_URL}
          width="48"
          height="48"
          alt="RiskModels"
          style={logo}
        />
        <Heading style={heading}>Auto-Refill Failed</Heading>

        <Text style={paragraph}>Hi {userName},</Text>

        <Text style={paragraph}>
          We were unable to process your automatic API balance refill. Your current
          balance is <strong>${Number(balanceUsd).toFixed(2)}</strong>.
        </Text>

        <Section style={alertContainer}>
          <Text style={alertText}>⚠️ {errorMessage}</Text>
        </Section>

        <Section style={buttonContainer}>
          <Button style={button} href={updatePaymentUrl}>
            Update Payment Method
          </Button>
        </Section>

        <Text style={paragraph}>
          Please update your payment method to avoid interruption of API access when
          your balance runs out.
        </Text>

        <Hr style={hr} />
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

export default AutoRefillFailedEmail;

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

const logo = { margin: '0 auto', display: 'block' };

const heading = {
  fontSize: '32px',
  lineHeight: '1.3',
  fontWeight: '700',
  color: '#d97706',
  textAlign: 'center' as const,
  margin: '30px 0',
};

const paragraph = {
  fontSize: '16px',
  lineHeight: '1.6',
  color: '#4a5568',
  margin: '16px 0',
  padding: '0 20px',
};

const alertContainer = {
  backgroundColor: '#fffbeb',
  borderLeft: '4px solid #f59e0b',
  borderRadius: '4px',
  padding: '20px',
  margin: '24px 20px',
};

const alertText = {
  fontSize: '16px',
  color: '#92400e',
  margin: '0',
};

const buttonContainer = {
  textAlign: 'center' as const,
  margin: '32px 0',
};

const button = {
  backgroundColor: '#10b981',
  borderRadius: '5px',
  color: '#fff',
  fontSize: '16px',
  fontWeight: 'bold',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '14px 32px',
};

const hr = { borderColor: '#e2e8f0', margin: '32px 0' };

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
