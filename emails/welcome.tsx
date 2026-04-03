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
import { BASE_URL, LOGO_URL, HOW_IT_WORKS_URL } from './constants';

interface WelcomeEmailProps {
  userName: string;
  dashboardUrl: string;
}

export const WelcomeEmail = ({
  userName = 'there',
  dashboardUrl = `${BASE_URL}/settings`,
}: WelcomeEmailProps) => (
  <Html>
    <Head />
    <Preview>Welcome to RiskModels - Your Portfolio Protection Platform</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img
          src={LOGO_URL}
          width="48"
          height="48"
          alt="RiskModels"
          style={logo}
        />
        <Heading style={heading}>Welcome to RiskModels, {userName}!</Heading>
        
        <Text style={paragraph}>
          Thank you for joining RiskModels. We&apos;re excited to help you protect your portfolio with our
          institutional-grade risk management platform.
        </Text>

        <Section style={buttonContainer}>
          <Button style={button} href={dashboardUrl}>
            Go to Dashboard
          </Button>
        </Section>

        <Hr style={hr} />

        <Heading as="h2" style={subheading}>
          Quick Start Guide
        </Heading>

        <Text style={paragraph}>
          <strong>1. Connect Your Brokerage</strong><br />
          Link your investment accounts securely via Plaid to analyze your holdings.
        </Text>

        <Text style={paragraph}>
          <strong>2. View Your Risk Analysis</strong><br />
          See your portfolio&apos;s factor exposures and market/sector/subsector risks.
        </Text>

        <Text style={paragraph}>
          <strong>3. Get Hedge Recommendations</strong><br />
          Receive personalized ETF hedge strategies to protect your wealth.
        </Text>

        <Hr style={hr} />

        <Heading as="h2" style={subheading}>
          Key Features
        </Heading>

        <Text style={paragraph}>
          • <strong>Bloomberg-Style Terminal:</strong> Professional-grade dashboard with real-time data<br />
          • <strong>L1/L2/L3 Hedge Strategies:</strong> Market, sector, and subsector risk protection<br />
          • <strong>Factor Risk Analysis:</strong> Understand what drives your portfolio&apos;s volatility<br />
          • <strong>PDF Risk Reports:</strong> Download institutional-quality audit reports
        </Text>

        <Hr style={hr} />

        <Text style={paragraph}>
          Need help? Check out our{' '}
          <Link href={HOW_IT_WORKS_URL} style={link}>
            How It Works
          </Link>{' '}
          guide or reply to this email with any questions.
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

export default WelcomeEmail;

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
  color: '#1a1a1a',
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

const buttonContainer = {
  textAlign: 'center' as const,
  margin: '32px 0',
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

