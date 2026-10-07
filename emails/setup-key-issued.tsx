import { Body, Container, Head, Html, Link, Preview, Text } from '@react-email/components';
import * as React from 'react';
const API_TERMS_URL = 'https://riskmodels.net/terms/api';
import { setupExample, type SetupWorkflow, type AgentClient } from './engagement-content';
export { API_TERMS_URL };

export interface KeyIssuedEmailProps {
  firstName: string;
  keyName: string;
  keyPrefix: string;
  createdDateFormatted: string;
  expiresAtFormatted: string;
  termsUrl: string;
  plaintextKey?: string;
  workflow?: SetupWorkflow;
  agentClient?: AgentClient | null;
  isFirstKey?: boolean;
  connected?: boolean;
}

export const KeyIssuedEmail = ({ firstName = 'there', keyName = 'API key', keyPrefix = 'rm_agent_',
  expiresAtFormatted = '', termsUrl = API_TERMS_URL, plaintextKey,
  workflow = 'exploring', agentClient = null, isFirstKey = true, connected = false }: KeyIssuedEmailProps) => {
  const example = setupExample(workflow, agentClient);
  return <Html><Head /><Preview>{isFirstKey ? example.title : 'Your new RiskModels API key'}</Preview>
    <Body style={{ backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif', color: '#111827' }}>
      <Container style={{ maxWidth: '600px', padding: '24px' }}>
        <Text>Hi {firstName},</Text>
        {connected ? <Text>Your RiskModels connection is ready.</Text> : <Text>{isFirstKey ? 'Your RiskModels access is ready.' : 'Your new RiskModels API key is ready.'} Your key is named <strong>{keyName}</strong>{expiresAtFormatted ? ` and expires ${expiresAtFormatted}` : ''}.</Text>}
        {!connected && (plaintextKey ? <><Text>Keep this key private:</Text><pre style={codeStyle}>{plaintextKey}</pre></>
          : <Text>Key prefix: {keyPrefix}. Manage your keys at <Link href="https://riskmodels.app/get-key">riskmodels.app/get-key</Link>.</Text>)}
        {isFirstKey && <>
          <Text style={{ fontWeight: 600 }}>{example.title}</Text>
          <Text>{connected ? 'Paste this into your connected assistant:' : example.instruction}</Text>
          {example.code && <pre style={codeStyle}>{example.code}</pre>}
          <Text>{example.expected}</Text>
          <Text><Link href={example.url}>Open your setup guide</Link></Text>
          <Text>What are you hoping to analyze? Reply here—I read these.</Text>
        </>}
        <Text>Best,<br />Conrad<br />Founder, RiskModels</Text>
        <Text style={{ fontSize: '12px', color: '#475569' }}>
          <Link href="https://riskmodels.app/get-key">Using a different setup?</Link> · <Link href={termsUrl}>API terms</Link>
        </Text>
      </Container>
    </Body></Html>;
};
const codeStyle: React.CSSProperties = { backgroundColor: '#f5f7fb', padding: '12px', fontSize: '12px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };
export default KeyIssuedEmail;
