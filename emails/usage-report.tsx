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

interface UsageReportEmailProps {
  userName: string;
  month: string;
  portfolioValue: number;
  hedgesExecuted: number;
  riskReduction: number;
  topHoldings: Array<{ ticker: string; value: number; risk: number }>;
}

export const UsageReportEmail = ({
  userName = 'there',
  month = 'December 2024',
  portfolioValue = 150000,
  hedgesExecuted = 3,
  riskReduction = 25,
  topHoldings = [
    { ticker: 'NVDA', value: 25000, risk: 18.5 },
    { ticker: 'AAPL', value: 20000, risk: 12.3 },
    { ticker: 'MSFT', value: 18000, risk: 10.8 },
  ],
}: UsageReportEmailProps) => (
  <Html>
    <Head />
    <Preview>Your {month} Portfolio Report - RiskModels</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img
          src={LOGO_URL}
          width="48"
          height="48"
          alt="RiskModels"
          style={logo}
        />
        <Heading style={heading}>{month} Portfolio Report</Heading>
        
        <Text style={paragraph}>
          Hi {userName},
        </Text>

        <Text style={paragraph}>
          Here&apos;s your monthly summary of portfolio protection and risk management activities.
        </Text>

        <Section style={statsGrid}>
          <table style={{ width: '100%' }}>
            <tr>
              <td style={statBox}>
                <Text style={statValue}>${(portfolioValue / 1000).toFixed(0)}K</Text>
                <Text style={statLabel}>Portfolio Value</Text>
              </td>
              <td style={statBox}>
                <Text style={statValue}>{hedgesExecuted}</Text>
                <Text style={statLabel}>Hedges Executed</Text>
              </td>
            </tr>
            <tr>
              <td style={statBox}>
                <Text style={{...statValue, color: '#10b981'}}>{riskReduction}%</Text>
                <Text style={statLabel}>Risk Reduction</Text>
              </td>
              <td style={statBox}>
                <Text style={statValue}>A+</Text>
                <Text style={statLabel}>Risk Score</Text>
              </td>
            </tr>
          </table>
        </Section>

        <Hr style={hr} />

        <Heading as="h2" style={subheading}>
          Top Holdings by Risk
        </Heading>

        <Section style={holdingsTable}>
          <table style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={tableHeader}>Ticker</th>
                <th style={{...tableHeader, textAlign: 'right'}}>Value</th>
                <th style={{...tableHeader, textAlign: 'right'}}>Risk %</th>
              </tr>
            </thead>
            <tbody>
              {topHoldings.map((holding, index) => (
                <tr key={index}>
                  <td style={tableCell}>{holding.ticker}</td>
                  <td style={{...tableCell, textAlign: 'right'}}>${(holding.value / 1000).toFixed(1)}K</td>
                  <td style={{...tableCell, textAlign: 'right', color: holding.risk > 15 ? '#ef4444' : '#10b981'}}>
                    {holding.risk.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section style={buttonContainer}>
          <Button style={button} href={`${BASE_URL}/settings`}>
            View Full Report
          </Button>
        </Section>

        <Hr style={hr} />

        <Text style={paragraph}>
          Want to improve your risk protection?{' '}
          <Link href={`${BASE_URL}/settings`} style={link}>
            Review your hedge recommendations
          </Link>{' '}
          in the dashboard.
        </Text>

        <Text style={footer}>
          RiskModels - Institutional Risk Management for Individual Investors<br />
          <Link href={`${BASE_URL}/settings`} style={footerLink}>
            Manage email preferences
          </Link>
        </Text>
      </Container>
    </Body>
  </Html>
);

export default UsageReportEmail;

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
  padding: '0 20px',
};

const paragraph = {
  fontSize: '16px',
  lineHeight: '1.6',
  color: '#4a5568',
  margin: '16px 0',
  padding: '0 20px',
};

const statsGrid = {
  margin: '24px 20px',
};

const statBox = {
  backgroundColor: '#f7fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  padding: '20px',
  textAlign: 'center' as const,
  width: '48%',
};

const statValue = {
  fontSize: '32px',
  fontWeight: '700',
  color: '#1a1a1a',
  margin: '0 0 8px 0',
};

const statLabel = {
  fontSize: '14px',
  color: '#718096',
  margin: '0',
};

const holdingsTable = {
  margin: '20px',
  backgroundColor: '#f7fafc',
  borderRadius: '8px',
  padding: '16px',
};

const tableHeader = {
  fontSize: '12px',
  fontWeight: '600',
  color: '#718096',
  textTransform: 'uppercase' as const,
  padding: '8px',
  textAlign: 'left' as const,
};

const tableCell = {
  fontSize: '15px',
  color: '#2d3748',
  padding: '12px 8px',
  borderTop: '1px solid #e2e8f0',
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

