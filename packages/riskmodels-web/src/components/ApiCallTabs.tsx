'use client';

import { useState } from 'react';

export type ApiCallTabId = 'curl' | 'js' | 'python';

export interface ApiCallTabsProps {
  ticker: string;
  baseUrl: string;
  /** Redacted key preview e.g. `rm_live_••••3f2a` */
  apiKeyPreview?: string | null;
  className?: string;
}

export function ApiCallTabs({ ticker, baseUrl, apiKeyPreview, className }: ApiCallTabsProps) {
  const [tab, setTab] = useState<ApiCallTabId>('curl');
  const origin = baseUrl.replace(/\/$/, '');
  const keyLine = apiKeyPreview ?? 'rm_live_YOUR_KEY';

  const curl = `curl -sS "${origin}/api/metrics/${ticker}" \\
  -H "Authorization: Bearer ${keyLine}"`;

  const js = `const r = await fetch("${origin}/api/metrics/${ticker}", {
  headers: { Authorization: "Bearer ${keyLine}" },
});
const data = await r.json();`;

  const py = `from riskmodels import RiskModelsClient
client = RiskModelsClient.from_env()
df = client.get_metrics("${ticker}")`;

  const body =
    tab === 'curl' ? curl : tab === 'js' ? js : py;

  return (
    <div className={className} style={{ borderRadius: 12, border: '1px solid #3f3f46', overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #3f3f46', background: '#0c0c0e' }}>
        {(
          [
            ['curl', 'cURL'] as const,
            ['js', 'JavaScript'] as const,
            ['python', 'Python SDK'] as const,
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            style={{
              flex: 1,
              padding: '10px 12px',
              fontSize: 12,
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              background: tab === id ? '#18181b' : 'transparent',
              color: tab === id ? '#fafafa' : '#71717a',
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <pre
        style={{
          margin: 0,
          padding: 16,
          fontSize: 12,
          lineHeight: 1.45,
          overflow: 'auto',
          background: '#09090b',
          color: '#d4d4d8',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        }}
      >
        {body}
      </pre>
    </div>
  );
}
