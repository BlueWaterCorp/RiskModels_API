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
import { BASE_URL, LOGO_URL, SUPPORT_URL } from './constants';

interface PaymentFailedEmailProps {
  userName: string;
  amount: number;
  updatePaymentUrl: string;
  gracePeriodDays: number;
}

export const PaymentFailedEmail = ({
  userName = 'there',
  amount = 49,
  updatePaymentUrl = `${BASE_URL}/settings`,
  gracePeriodDays = 3,
}: PaymentFailedEmailProps) => (
  <Html>
    <Head />
    <Preview>Action Required: Update Your Payment Method - RiskModels</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img
          src={LOGO_URL}
          width="48"
          height="48"
          alt="RiskModels"
          style={logo}
        />
        <Heading style={heading}>Payment Update Required</Heading>
        
        <Text style={paragraph}>
          Hi {userName},
        </Text>

        <Text style={paragraph}>
          We were unable to process your payment of <strong>${amount.toFixed(2)}</strong> for 
          your RiskModels subscription.
        </Text>

        <Section style={alertContainer}>
          <Text style={alertText}>
            ⚠️ Your account will remain active for <strong>{gracePeriodDays} more days</strong> while 
            you update your payment information.
          </Text>
        </Section>

        <Section style={buttonContainer}>
          <Button style={button} href={updatePaymentUrl}>
            Update Payment Method
          </Button>
        </Section>

        <Hr style={hr} />

        <Heading as="h2" style={subheading}>
          Common Payment Issues:
        </Heading>

        <Text style={paragraph}>
          • <strong>Expired Card:</strong> Check if your card has expired<br />
          • <strong>Insufficient Funds:</strong> Ensure adequate balance<br />
          • <strong>Billing Address:</strong> Verify your billing address is correct<br />
          • <strong>Card Restrictions:</strong> Some cards block international transactions
        </Text>

        <Hr style={hr} />

        <Text style={paragraph}>
          After {gracePeriodDays} days, your account will be downgraded to the free tier and you&apos;ll
          lose access to:
        </Text>

        <Text style={paragraph}>
          • Advanced L2/L3 hedge strategies<br />
          • PDF risk report downloads<br />
          • Historical data beyond 3 months<br />
          • Real-time portfolio alerts
        </Text>

        <Hr style={hr} />

        <Text style={paragraph}>
          Need help? Contact our support team by replying to this email or visiting our{' '}
          <Link href={SUPPORT_URL} style={link}>
            Help Center
          </Link>.
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

export default PaymentFailedEmail;

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
  color: '#ef4444',
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

const alertContainer = {
  backgroundColor: '#fef2f2',
  borderLeft: '4px solid #ef4444',
  borderRadius: '4px',
  padding: '20px',
  margin: '24px 20px',
};

const alertText = {
  fontSize: '16px',
  color: '#991b1b',
  margin: '0',
};

const buttonContainer = {
  textAlign: 'center' as const,
  margin: '32px 0',
};

const button = {
  backgroundColor: '#ef4444',
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

