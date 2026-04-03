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

interface AutoRefillSuccessEmailProps {
  userName: string;
  amountUsd: number;
  tokenAmount: number;
  newBalance: number;
  paymentIntentId: string;
  topUpUrl: string;
}

export const AutoRefillSuccessEmail = ({
  userName = 'Developer',
  amountUsd = 20,
  tokenAmount = 1_000_000,
  newBalance = 24.5,
  topUpUrl = `${BASE_URL}/settings?tab=billing`,
}: AutoRefillSuccessEmailProps) => (
  <Html>
    <Head />
    <Preview>Your RiskModels API balance has been auto-refilled</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img
          src={LOGO_URL}
          width="48"
          height="48"
          alt="RiskModels"
          style={logo}
        />
        <Heading style={heading}>Balance Auto-Refilled</Heading>

        <Text style={paragraph}>Hi {userName},</Text>

        <Text style={paragraph}>
          Your RiskModels API balance has been automatically refilled with{' '}
          <strong>${amountUsd.toFixed(2)}</strong> (~{tokenAmount.toLocaleString()} tokens).
          Your new balance is <strong>${newBalance.toFixed(2)}</strong>.
        </Text>

        <Section style={buttonContainer}>
          <Button style={button} href={topUpUrl}>
            View Balance & Settings
          </Button>
        </Section>

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

export default AutoRefillSuccessEmail;

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
  color: '#10b981',
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
