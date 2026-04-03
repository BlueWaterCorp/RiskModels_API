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

interface MarketInsightsEmailProps {
  userName: string;
  week: string;
  marketVolatility: number;
  topRisks: Array<{ sector: string; exposure: number }>;
  recommendedHedges: Array<{ ticker: string; hedgeRatio: number; etf: string }>;
}

export const MarketInsightsEmail = ({
  userName = 'there',
  week = 'Week of Dec 25, 2024',
  marketVolatility = 18.5,
  topRisks = [
    { sector: 'Technology', exposure: 45 },
    { sector: 'Healthcare', exposure: 22 },
    { sector: 'Financials', exposure: 18 },
  ],
  recommendedHedges = [
    { ticker: 'NVDA', hedgeRatio: 0.35, etf: 'SOXS' },
    { ticker: 'AAPL', hedgeRatio: 0.25, etf: 'XLK' },
  ],
}: MarketInsightsEmailProps) => (
  <Html>
    <Head />
    <Preview>Weekly Market Insights & Hedge Recommendations - RiskModels</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img
          src={LOGO_URL}
          width="48"
          height="48"
          alt="RiskModels"
          style={logo}
        />
        <Heading style={heading}>Weekly Market Insights</Heading>
        
        <Text style={paragraph}>
          Hi {userName},
        </Text>

        <Text style={paragraph}>
          Here&apos;s your personalized market analysis for {week}.
        </Text>

        <Section style={alertBox}>
          <Text style={alertTitle}>Market Volatility</Text>
          <Text style={{...alertValue, color: marketVolatility > 20 ? '#ef4444' : '#f59e0b'}}>
            {marketVolatility.toFixed(1)}%
          </Text>
          <Text style={alertLabel}>
            {marketVolatility > 20 ? 'High Volatility' : 'Elevated Volatility'}
          </Text>
        </Section>

        <Hr style={hr} />

        <Heading as="h2" style={subheading}>
          Your Top Sector Exposures
        </Heading>

        <Section style={risksContainer}>
          {topRisks.map((risk, index) => (
            <div key={index} style={riskItem}>
              <div style={riskHeader}>
                <Text style={riskSector}>{risk.sector}</Text>
                <Text style={riskPercentage}>{risk.exposure}%</Text>
              </div>
              <div style={progressBar}>
                <div style={{...progressFill, width: `${risk.exposure}%`}} />
              </div>
            </div>
          ))}
        </Section>

        <Hr style={hr} />

        <Heading as="h2" style={subheading}>
          Recommended Hedges
        </Heading>

        <Text style={paragraph}>
          Based on current market conditions and your portfolio composition:
        </Text>

        <Section style={hedgesContainer}>
          {recommendedHedges.map((hedge, index) => (
            <div key={index} style={hedgeCard}>
              <Text style={hedgeTicker}>{hedge.ticker}</Text>
              <Text style={hedgeDetails}>
                Hedge Ratio: <strong>{(hedge.hedgeRatio * 100).toFixed(0)}%</strong>
              </Text>
              <Text style={hedgeDetails}>
                Using: <strong>{hedge.etf}</strong>
              </Text>
            </div>
          ))}
        </Section>

        <Section style={buttonContainer}>
          <Button style={button} href={`${BASE_URL}/settings`}>
            View Full Analysis
          </Button>
        </Section>

        <Hr style={hr} />

        <Text style={paragraph}>
          <strong>Market Commentary:</strong> Current volatility suggests increased downside risk. 
          Consider implementing protective hedges to preserve capital during potential drawdowns.
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

export default MarketInsightsEmail;

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

const alertBox = {
  backgroundColor: '#fef3c7',
  border: '2px solid #f59e0b',
  borderRadius: '8px',
  padding: '24px',
  margin: '24px 20px',
  textAlign: 'center' as const,
};

const alertTitle = {
  fontSize: '14px',
  fontWeight: '600',
  color: '#92400e',
  textTransform: 'uppercase' as const,
  margin: '0 0 8px 0',
};

const alertValue = {
  fontSize: '48px',
  fontWeight: '700',
  margin: '8px 0',
};

const alertLabel = {
  fontSize: '16px',
  color: '#92400e',
  margin: '8px 0 0 0',
};

const risksContainer = {
  margin: '20px',
};

const riskItem = {
  marginBottom: '20px',
};

const riskHeader = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '8px',
};

const riskSector = {
  fontSize: '15px',
  fontWeight: '600',
  color: '#2d3748',
  margin: '0',
};

const riskPercentage = {
  fontSize: '15px',
  fontWeight: '700',
  color: '#3b82f6',
  margin: '0',
};

const progressBar = {
  width: '100%',
  height: '8px',
  backgroundColor: '#e2e8f0',
  borderRadius: '4px',
  overflow: 'hidden',
};

const progressFill = {
  height: '100%',
  backgroundColor: '#3b82f6',
};

const hedgesContainer = {
  display: 'flex',
  gap: '16px',
  margin: '20px',
  flexWrap: 'wrap' as const,
};

const hedgeCard = {
  flex: '1',
  minWidth: '200px',
  backgroundColor: '#f7fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  padding: '20px',
};

const hedgeTicker = {
  fontSize: '20px',
  fontWeight: '700',
  color: '#1a1a1a',
  margin: '0 0 12px 0',
};

const hedgeDetails = {
  fontSize: '14px',
  color: '#4a5568',
  margin: '6px 0',
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

