'use client';

import { useEffect, useRef, useState } from 'react';
import { JetBrains_Mono } from 'next/font/google';

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
});

const TYPING_SPEED_MS = 38;
const REPLAY_DELAY_MS = 5000;

type Phase = 'typing' | 'output' | 'done';

interface ScenarioLine {
  id: number;
  content: React.ReactNode;
  delayMs: number;
}

interface Scenario {
  id: string;
  label: string;
  titleBarLabel: string;
  contextBadge: string;
  command: string;
  lines: ScenarioLine[];
}

// GitHub Dark syntax palette
const C = {
  prompt:  '#3b82f6',
  info:    '#e3b341',
  alert:   '#ff7b72',
  muted:   '#8b9ab8',
  bright:  '#cdd9e5',
  key:     '#79c0ff',
  str:     '#a5d6ff',
  num:     '#ffa657',
  bool_t:  '#ff7b72',
  green:   '#56d364',
  action:  '#d2a8ff',
  dim:     '#6e7681',
  mcp_fwd: '#d2a8ff',
  mcp_bck: '#56d364',
};

// ─── Scenario A: Agent Decompose ──────────────────────────────────────────────
const scenarioA: Scenario = {
  id: 'decompose',
  label: 'Agent Decompose',
  titleBarLabel: 'riskmodels agent decompose — L3 portfolio attribution',
  contextBadge: 'portfolio: positions.json',
  command: 'riskmodels agent decompose --portfolio ./positions.json',
  lines: [
    {
      id: 0, delayMs: 0,
      content: <><span style={{ color: C.info }}>[INFO]</span> <span style={{ color: C.muted }}>Loading portfolio: 8 holdings detected...</span></>,
    },
    {
      id: 1, delayMs: 480,
      content: <><span style={{ color: C.info }}>[INFO]</span> <span style={{ color: C.muted }}>Calling POST /batch/analyze (ERM3-L3-v30)...</span></>,
    },
    {
      id: 2, delayMs: 960,
      content: <><span style={{ color: C.info }}>[INFO]</span> <span style={{ color: C.muted }}>L3 attribution complete. Building response...</span></>,
    },
    { id: 3, delayMs: 1240, content: <span>&nbsp;</span> },
    { id: 4, delayMs: 1380, content: <span style={{ color: C.dim }}>{'{'}</span> },
    {
      id: 5, delayMs: 1540,
      content: <span>&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;portfolio_beta&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.num }}>1.14</span><span style={{ color: C.dim }}>,</span></span>,
    },
    {
      id: 6, delayMs: 1700,
      content: <span>&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;dominant_factor&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.str }}>&quot;market&quot;</span><span style={{ color: C.dim }}>,</span></span>,
    },
    {
      id: 7, delayMs: 1860,
      content: <span>&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;holdings&quot;</span><span style={{ color: C.dim }}>: {'{'}</span></span>,
    },
    {
      id: 8, delayMs: 2020,
      content: <span>&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;NVDA&quot;</span><span style={{ color: C.dim }}>: {'{'} </span><span style={{ color: C.key }}>&quot;l3_mkt_hr&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.num }}>0.97</span><span style={{ color: C.dim }}>, </span><span style={{ color: C.key }}>&quot;l3_sec_hr&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.num }}>0.14</span><span style={{ color: C.dim }}>, </span><span style={{ color: C.key }}>&quot;sector_etf&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.str }}>&quot;SOXX&quot;</span><span style={{ color: C.dim }}> {'},'}</span></span>,
    },
    {
      id: 9, delayMs: 2180,
      content: <span>&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;MSFT&quot;</span><span style={{ color: C.dim }}>: {'{'} </span><span style={{ color: C.key }}>&quot;l3_mkt_hr&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.num }}>0.88</span><span style={{ color: C.dim }}>, </span><span style={{ color: C.key }}>&quot;l3_sec_hr&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.num }}>0.11</span><span style={{ color: C.dim }}>, </span><span style={{ color: C.key }}>&quot;sector_etf&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.str }}>&quot;XLK&quot;</span><span style={{ color: C.dim }}> {'},'}</span></span>,
    },
    {
      id: 10, delayMs: 2340,
      content: <span>&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;AAPL&quot;</span><span style={{ color: C.dim }}>: {'{'} </span><span style={{ color: C.key }}>&quot;l3_mkt_hr&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.num }}>0.85</span><span style={{ color: C.dim }}>, </span><span style={{ color: C.key }}>&quot;l3_sec_hr&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.num }}>0.12</span><span style={{ color: C.dim }}>, </span><span style={{ color: C.key }}>&quot;sector_etf&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.str }}>&quot;XLK&quot;</span><span style={{ color: C.dim }}> {'}'}</span></span>,
    },
    { id: 11, delayMs: 2500, content: <span style={{ color: C.dim }}>&nbsp;&nbsp;{'},'}</span> },
    {
      id: 12, delayMs: 2660,
      content: <span>&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;_metadata&quot;</span><span style={{ color: C.dim }}>: {'{'} </span><span style={{ color: C.key }}>&quot;model_version&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.str }}>&quot;ERM3-L3-v30&quot;</span><span style={{ color: C.dim }}>, </span><span style={{ color: C.key }}>&quot;universe_size&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.num }}>2987</span><span style={{ color: C.dim }}> {'}'}</span></span>,
    },
    { id: 13, delayMs: 2820, content: <span style={{ color: C.dim }}>{'}'}</span> },
  ],
};

// ─── Scenario B: REST /metrics snapshot ───────────────────────────────────────
const scenarioB: Scenario = {
  id: 'metrics',
  label: 'REST /metrics',
  titleBarLabel: 'GET https://riskmodels.app/api/metrics/NVDA',
  contextBadge: 'ticker: NVDA',
  command: 'curl -H "Authorization: Bearer rm_agent_live_..." https://riskmodels.app/api/metrics/NVDA',
  lines: [
    { id: 0, delayMs: 0,   content: <span style={{ color: C.dim }}>{'{'}</span> },
    { id: 1, delayMs: 200, content: <span>&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;ticker&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.str }}>&quot;NVDA&quot;</span><span style={{ color: C.dim }}>,</span></span> },
    { id: 2, delayMs: 380, content: <span>&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;teo&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.str }}>&quot;2026-03-20&quot;</span><span style={{ color: C.dim }}>,</span></span> },
    { id: 3, delayMs: 560, content: <span>&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;periodicity&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.str }}>&quot;daily&quot;</span><span style={{ color: C.dim }}>,</span></span> },
    { id: 4, delayMs: 720, content: <span>&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;metrics&quot;</span><span style={{ color: C.dim }}>: {'{'}</span></span> },
    { id: 5, delayMs: 880, content: <span>&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;vol_23d&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.num }}>0.42</span><span style={{ color: C.dim }}>,</span></span> },
    { id: 6, delayMs: 1040, content: <span>&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;price_close&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.num }}>950.25</span><span style={{ color: C.dim }}>,</span></span> },
    { id: 7, delayMs: 1200, content: <span>&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;l3_mkt_hr&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.num }}>0.97</span><span style={{ color: C.dim }}>,</span></span> },
    { id: 8, delayMs: 1360, content: <span>&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;l3_sec_hr&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.num }}>0.14</span><span style={{ color: C.dim }}>,</span></span> },
    { id: 9, delayMs: 1520, content: <span>&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;l3_sub_hr&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.num }}>0.03</span><span style={{ color: C.dim }}>,</span></span> },
    { id: 10, delayMs: 1680, content: <span>&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;l3_res_er&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.num }}>0.29</span></span> },
    { id: 11, delayMs: 1840, content: <span style={{ color: C.dim }}>&nbsp;&nbsp;{'},'}</span> },
    {
      id: 12, delayMs: 2000,
      content: <span>&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;meta&quot;</span><span style={{ color: C.dim }}>: {'{'} </span><span style={{ color: C.key }}>&quot;sector_etf&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.str }}>&quot;SOXX&quot;</span><span style={{ color: C.dim }}>, </span><span style={{ color: C.key }}>&quot;asset_type&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.str }}>&quot;EQUITY&quot;</span><span style={{ color: C.dim }}> {'},'}</span></span>,
    },
    {
      id: 13, delayMs: 2160,
      content: <span>&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;_metadata&quot;</span><span style={{ color: C.dim }}>: {'{'} </span><span style={{ color: C.key }}>&quot;model_version&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.str }}>&quot;ERM3-L3-v30&quot;</span><span style={{ color: C.dim }}>, </span><span style={{ color: C.key }}>&quot;data_as_of&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.str }}>&quot;2026-03-20&quot;</span><span style={{ color: C.dim }}> {'},'}</span></span>,
    },
    {
      id: 14, delayMs: 2320,
      content: <span>&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;_data_health&quot;</span><span style={{ color: C.dim }}>: {'{'} </span><span style={{ color: C.key }}>&quot;er_populated&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.green }}>true</span><span style={{ color: C.dim }}>, </span><span style={{ color: C.key }}>&quot;data_as_of&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.str }}>&quot;2026-03-20&quot;</span><span style={{ color: C.dim }}> {'}'}</span></span>,
    },
    { id: 15, delayMs: 2500, content: <span style={{ color: C.dim }}>{'}'}</span> },
  ],
};

// ─── Scenario C: Drift Monitor ────────────────────────────────────────────────
const scenarioC: Scenario = {
  id: 'monitor',
  label: 'Drift Monitor',
  titleBarLabel: 'riskmodels agent monitor — factor drift detection',
  contextBadge: 'portfolio: positions.json',
  command: 'riskmodels agent monitor --portfolio ./positions.json --threshold 2.0',
  lines: [
    { id: 0, delayMs: 0,    content: <><span style={{ color: C.info }}>[INFO]</span> <span style={{ color: C.muted }}>Checking 8 holdings against target allocations...</span></> },
    { id: 1, delayMs: 480,  content: <><span style={{ color: C.info }}>[INFO]</span> <span style={{ color: C.muted }}>Computing 23-day rolling volatility...</span></> },
    { id: 2, delayMs: 900,  content: <><span style={{ color: C.info }}>[INFO]</span> <span style={{ color: C.muted }}>Factor drift analysis complete.</span></> },
    { id: 3, delayMs: 1180, content: <span>&nbsp;</span> },
    { id: 4, delayMs: 1320, content: <><span style={{ color: C.alert }}>[ALERT]</span> <span style={{ color: '#f0c674' }}>Size factor: +2.3σ above threshold (2.0σ)</span></> },
    { id: 5, delayMs: 1560, content: <><span style={{ color: C.alert }}>[ALERT]</span> <span style={{ color: '#f0c674' }}>Sector concentration: Technology 71% (target 45%)</span></> },
    { id: 6, delayMs: 1860, content: <span>&nbsp;</span> },
    { id: 7, delayMs: 2010, content: <span style={{ color: C.dim }}>{'{'}</span> },
    { id: 8, delayMs: 2160, content: <span>&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;drift_detected&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.bool_t }}>true</span><span style={{ color: C.dim }}>,</span></span> },
    {
      id: 9, delayMs: 2320,
      content: <span>&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;breached_factors&quot;</span><span style={{ color: C.dim }}>: [</span><span style={{ color: C.str }}>&quot;size&quot;</span><span style={{ color: C.dim }}>, </span><span style={{ color: C.str }}>&quot;tech_sector&quot;</span><span style={{ color: C.dim }}>],</span></span>,
    },
    {
      id: 10, delayMs: 2500,
      content: <span>&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;suggested_hedge&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.action }}>&quot;short XLK 14.2% notional&quot;</span><span style={{ color: C.dim }}>,</span></span>,
    },
    {
      id: 11, delayMs: 2680,
      content: <span>&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;_metadata&quot;</span><span style={{ color: C.dim }}>: {'{'} </span><span style={{ color: C.key }}>&quot;model_version&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.str }}>&quot;ERM3-L3-v30&quot;</span><span style={{ color: C.dim }}>, </span><span style={{ color: C.key }}>&quot;universe_size&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.num }}>2987</span><span style={{ color: C.dim }}> {'}'}</span></span>,
    },
    { id: 12, delayMs: 2840, content: <span style={{ color: C.dim }}>{'}'}</span> },
  ],
};

// ─── Scenario D: Estimate + Batch ─────────────────────────────────────────────
const scenarioD: Scenario = {
  id: 'estimate',
  label: 'Estimate + Batch',
  titleBarLabel: 'POST /estimate → POST /batch/analyze — pay-as-you-go',
  contextBadge: 'AAPL · NVDA · MSFT · META',
  command: 'riskmodels estimate --endpoint batch/analyze --tickers AAPL,NVDA,MSFT,META',
  lines: [
    { id: 0, delayMs: 0,    content: <span style={{ color: C.dim }}>{'{'}</span> },
    { id: 1, delayMs: 200,  content: <span>&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;estimated_cost_usd&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.green }}>0.008</span><span style={{ color: C.dim }}>,</span></span> },
    { id: 2, delayMs: 380,  content: <span>&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;estimated_rows&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.num }}>4</span><span style={{ color: C.dim }}>,</span></span> },
    { id: 3, delayMs: 560,  content: <span>&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;capability&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.str }}>&quot;batch-analysis&quot;</span><span style={{ color: C.dim }}>,</span></span> },
    { id: 4, delayMs: 720,  content: <span>&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;pricing_model&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.str }}>&quot;per_request&quot;</span></span> },
    { id: 5, delayMs: 880,  content: <span style={{ color: C.dim }}>{'}'}</span> },
    { id: 6, delayMs: 1020, content: <span>&nbsp;</span> },
    {
      id: 7, delayMs: 1160,
      content: <span><span style={{ color: C.muted }}>Proceed? [y/n] </span><span style={{ color: C.green }}>y</span></span>,
    },
    { id: 8, delayMs: 1300, content: <span>&nbsp;</span> },
    // Second command rendered as a new prompt line
    {
      id: 9, delayMs: 1420,
      content: <span><span style={{ color: C.prompt }}>$</span> <span style={{ color: C.bright }}>riskmodels analyze --tickers AAPL,NVDA,MSFT,META --metrics hedge_ratios</span></span>,
    },
    { id: 10, delayMs: 1620, content: <span>&nbsp;</span> },
    { id: 11, delayMs: 1760, content: <span style={{ color: C.dim }}>{'{'}</span> },
    { id: 12, delayMs: 1900, content: <span>&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;results&quot;</span><span style={{ color: C.dim }}>: {'{'}</span></span> },
    {
      id: 13, delayMs: 2040,
      content: <span>&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;AAPL&quot;</span><span style={{ color: C.dim }}>: {'{'} </span><span style={{ color: C.key }}>&quot;l3_mkt_hr&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.num }}>0.85</span><span style={{ color: C.dim }}>, </span><span style={{ color: C.key }}>&quot;l3_sec_hr&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.num }}>0.12</span><span style={{ color: C.dim }}>, </span><span style={{ color: C.key }}>&quot;sector_etf&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.str }}>&quot;XLK&quot;</span><span style={{ color: C.dim }}> {'},'}</span></span>,
    },
    {
      id: 14, delayMs: 2180,
      content: <span>&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;NVDA&quot;</span><span style={{ color: C.dim }}>: {'{'} </span><span style={{ color: C.key }}>&quot;l3_mkt_hr&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.num }}>0.97</span><span style={{ color: C.dim }}>, </span><span style={{ color: C.key }}>&quot;l3_sec_hr&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.num }}>0.14</span><span style={{ color: C.dim }}>, </span><span style={{ color: C.key }}>&quot;sector_etf&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.str }}>&quot;SOXX&quot;</span><span style={{ color: C.dim }}> {'},'}</span></span>,
    },
    {
      id: 15, delayMs: 2320,
      content: <span>&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;MSFT&quot;</span><span style={{ color: C.dim }}>: {'{'} </span><span style={{ color: C.key }}>&quot;l3_mkt_hr&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.num }}>0.88</span><span style={{ color: C.dim }}>, </span><span style={{ color: C.key }}>&quot;l3_sec_hr&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.num }}>0.11</span><span style={{ color: C.dim }}>, </span><span style={{ color: C.key }}>&quot;sector_etf&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.str }}>&quot;XLK&quot;</span><span style={{ color: C.dim }}> {'},'}</span></span>,
    },
    {
      id: 16, delayMs: 2460,
      content: <span>&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;META&quot;</span><span style={{ color: C.dim }}>: {'{'} </span><span style={{ color: C.key }}>&quot;l3_mkt_hr&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.num }}>0.91</span><span style={{ color: C.dim }}>, </span><span style={{ color: C.key }}>&quot;l3_sec_hr&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.num }}>0.09</span><span style={{ color: C.dim }}>, </span><span style={{ color: C.key }}>&quot;sector_etf&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.str }}>&quot;XLC&quot;</span><span style={{ color: C.dim }}> {'}'}</span></span>,
    },
    { id: 17, delayMs: 2610, content: <span style={{ color: C.dim }}>&nbsp;&nbsp;{'},'}</span> },
    {
      id: 18, delayMs: 2760,
      content: <span>&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;_agent&quot;</span><span style={{ color: C.dim }}>: {'{'} </span><span style={{ color: C.key }}>&quot;cost_usd&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.green }}>0.008</span><span style={{ color: C.dim }}>, </span><span style={{ color: C.key }}>&quot;tickers_analyzed&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.num }}>4</span><span style={{ color: C.dim }}> {'}'}</span></span>,
    },
    { id: 19, delayMs: 2910, content: <span style={{ color: C.dim }}>{'}'}</span> },
  ],
};

// ─── Scenario E: MCP Agent ────────────────────────────────────────────────────
const scenarioE: Scenario = {
  id: 'mcp',
  label: 'MCP Agent',
  titleBarLabel: 'riskmodels.app/api/mcp/sse — JSON-RPC 2.0 tool call',
  contextBadge: 'SSE · tool: riskmodels_get_capability',
  command: 'curl -N -H "Authorization: Bearer rm_agent_live_..." https://riskmodels.app/api/mcp/sse',
  lines: [
    {
      id: 0, delayMs: 0,
      content: <><span style={{ color: C.green }}>[SSE]</span> <span style={{ color: C.muted }}>Connected to https://riskmodels.app/api/mcp/sse</span></>,
    },
    {
      id: 1, delayMs: 380,
      content: <><span style={{ color: C.green }}>[MCP]</span> <span style={{ color: C.muted }}>Server capabilities: tools, resources, prompts</span></>,
    },
    { id: 2, delayMs: 650, content: <span>&nbsp;</span> },
    {
      id: 3, delayMs: 800,
      content: <span><span style={{ color: C.mcp_fwd }}>→ tool_call: </span><span style={{ color: C.bright }}>riskmodels_get_capability</span></span>,
    },
    {
      id: 4, delayMs: 1000,
      content: <span>&nbsp;&nbsp;<span style={{ color: C.dim }}>{'{'} </span><span style={{ color: C.key }}>&quot;id&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.str }}>&quot;ticker-returns&quot;</span><span style={{ color: C.dim }}> {'}'}</span></span>,
    },
    { id: 5, delayMs: 1200, content: <span>&nbsp;</span> },
    {
      id: 6, delayMs: 1350,
      content: <><span style={{ color: C.info }}>[MCP]</span> <span style={{ color: C.muted }}>Returning capability metadata for ticker-returns (then call REST /api/ticker-returns for rows).</span></>,
    },
    {
      id: 7, delayMs: 1800,
      content: <><span style={{ color: C.info }}>[MCP]</span> <span style={{ color: C.muted }}>Example: GET https://riskmodels.app/api/ticker-returns?ticker=NVDA&amp;years=1</span></>,
    },
    { id: 8, delayMs: 2100, content: <span>&nbsp;</span> },
    {
      id: 9, delayMs: 2250,
      content: <span><span style={{ color: C.mcp_bck }}>← tool_result:</span></span>,
    },
    { id: 10, delayMs: 2400, content: <span style={{ color: C.dim }}>{'{'}</span> },
    { id: 11, delayMs: 2540, content: <span>&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;ticker&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.str }}>&quot;NVDA&quot;</span><span style={{ color: C.dim }}>,</span></span> },
    { id: 12, delayMs: 2680, content: <span>&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;periodicity&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.str }}>&quot;daily&quot;</span><span style={{ color: C.dim }}>,</span></span> },
    {
      id: 13, delayMs: 2820,
      content: <span>&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;data&quot;</span><span style={{ color: C.dim }}>: [ {'{'} </span><span style={{ color: C.key }}>&quot;date&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.str }}>&quot;2026-03-20&quot;</span><span style={{ color: C.dim }}>, </span><span style={{ color: C.key }}>&quot;returns_gross&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.green }}>0.031</span><span style={{ color: C.dim }}>,</span></span>,
    },
    {
      id: 14, delayMs: 2970,
      content: <span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;l3_mkt_hr&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.num }}>0.97</span><span style={{ color: C.dim }}>, </span><span style={{ color: C.key }}>&quot;l3_res_er&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.num }}>0.29</span><span style={{ color: C.dim }}> {'}'}, ... ],</span></span>,
    },
    {
      id: 15, delayMs: 3120,
      content: <span>&nbsp;&nbsp;<span style={{ color: C.key }}>&quot;_metadata&quot;</span><span style={{ color: C.dim }}>: {'{'} </span><span style={{ color: C.key }}>&quot;model_version&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.str }}>&quot;ERM3-L3-v30&quot;</span><span style={{ color: C.dim }}>, </span><span style={{ color: C.key }}>&quot;universe_size&quot;</span><span style={{ color: C.dim }}>: </span><span style={{ color: C.num }}>2987</span><span style={{ color: C.dim }}> {'}'}</span></span>,
    },
    { id: 16, delayMs: 3280, content: <span style={{ color: C.dim }}>{'}'}</span> },
  ],
};

// ─── Scenario F: Python SDK (PyPI install + agent-native run) ────────────────
const scenarioF: Scenario = {
  id: 'python-sdk',
  label: 'Python SDK',
  titleBarLabel: 'pip install riskmodels-py[xarray] → portfolio_llm.py',
  contextBadge: 'PyPI · NVDA 40% · GOOGL 60%',
  command: 'pip install riskmodels-py[xarray] && python portfolio_llm.py',
  lines: [
    {
      id: 0,
      delayMs: 0,
      content: (
        <>
          <span style={{ color: C.muted }}>Collecting riskmodels-py</span>
        </>
      ),
    },
    {
      id: 1,
      delayMs: 320,
      content: (
        <>
          <span style={{ color: C.muted }}> </span>
          <span style={{ color: C.muted }}>Downloading riskmodels_py-0.2.0-py3-none-any.whl (35 kB)</span>
        </>
      ),
    },
    {
      id: 2,
      delayMs: 620,
      content: (
        <>
          <span style={{ color: C.muted }}>Installing collected packages: riskmodels-py</span>
        </>
      ),
    },
    {
      id: 3,
      delayMs: 900,
      content: (
        <>
          <span style={{ color: C.green }}>Successfully installed riskmodels-py-0.2.0</span>
        </>
      ),
    },
    { id: 4, delayMs: 1120, content: <span>&nbsp;</span> },
    {
      id: 5,
      delayMs: 1280,
      content: (
        <>
          <span style={{ color: C.info }}>[INFO]</span>{' '}
          <span style={{ color: C.muted }}>RiskModelsClient.from_env() → authenticated via RISKMODELS_API_KEY</span>
        </>
      ),
    },
    {
      id: 6,
      delayMs: 1680,
      content: (
        <>
          <span style={{ color: C.info }}>[INFO]</span>{' '}
          <span style={{ color: C.muted }}>Ticker alias detected: GOOGL → GOOG (canonical)</span>
        </>
      ),
    },
    {
      id: 7,
      delayMs: 2080,
      content: (
        <>
          <span style={{ color: C.info }}>[INFO]</span>{' '}
          <span style={{ color: C.muted }}>POST /batch/analyze → 2 tickers, 252 dates, semantic normalization complete</span>
        </>
      ),
    },
    { id: 8, delayMs: 2380, content: <span>&nbsp;</span> },
    {
      id: 9,
      delayMs: 2520,
      content: <span style={{ color: C.dim }}>## Portfolio Hedge Ratios (Holdings-Weighted)</span>,
    },
    { id: 10, delayMs: 2680, content: <span>&nbsp;</span> },
    {
      id: 11,
      delayMs: 2820,
      content: (
        <span>
          <span style={{ color: C.dim }}>| </span>
          <span style={{ color: C.key }}>metric</span>
          <span style={{ color: C.dim }}> | </span>
          <span style={{ color: C.key }}>value</span>
          <span style={{ color: C.dim }}> | </span>
          <span style={{ color: C.key }}>unit</span>
          <span style={{ color: C.dim }}> |</span>
        </span>
      ),
    },
    {
      id: 12,
      delayMs: 2960,
      content: <span style={{ color: C.dim }}>|--------|-------|------|</span>,
    },
    {
      id: 13,
      delayMs: 3100,
      content: (
        <span>
          <span style={{ color: C.dim }}>| </span>
          <span style={{ color: C.bright }}>l3_market_hr</span>
          <span style={{ color: C.dim }}> | </span>
          <span style={{ color: C.num }}>0.91</span>
          <span style={{ color: C.dim }}> | </span>
          <span style={{ color: C.muted }}>$/$ SPY</span>
          <span style={{ color: C.dim }}> |</span>
        </span>
      ),
    },
    {
      id: 14,
      delayMs: 3240,
      content: (
        <span>
          <span style={{ color: C.dim }}>| </span>
          <span style={{ color: C.bright }}>l3_sector_hr</span>
          <span style={{ color: C.dim }}> | </span>
          <span style={{ color: C.num }}>0.13</span>
          <span style={{ color: C.dim }}> | </span>
          <span style={{ color: C.muted }}>$/$ XLK</span>
          <span style={{ color: C.dim }}> |</span>
        </span>
      ),
    },
    {
      id: 15,
      delayMs: 3380,
      content: (
        <span>
          <span style={{ color: C.dim }}>| </span>
          <span style={{ color: C.bright }}>l3_subsector_hr</span>
          <span style={{ color: C.dim }}> | </span>
          <span style={{ color: C.num }}>0.07</span>
          <span style={{ color: C.dim }}> | </span>
          <span style={{ color: C.muted }}>$/$ SOXX</span>
          <span style={{ color: C.dim }}> |</span>
        </span>
      ),
    },
    {
      id: 16,
      delayMs: 3520,
      content: (
        <span>
          <span style={{ color: C.dim }}>| </span>
          <span style={{ color: C.bright }}>l3_residual_er</span>
          <span style={{ color: C.dim }}> | </span>
          <span style={{ color: C.num }}>0.24</span>
          <span style={{ color: C.dim }}> | </span>
          <span style={{ color: C.muted }}>variance fraction</span>
          <span style={{ color: C.dim }}> |</span>
        </span>
      ),
    },
    { id: 17, delayMs: 3700, content: <span>&nbsp;</span> },
    {
      id: 18,
      delayMs: 3840,
      content: (
        <span style={{ color: C.dim }}>
          <span style={{ color: C.muted }}>Lineage: ERM3-L3-v30 · 2026-03-20 · 2,987 universe</span>
        </span>
      ),
    },
  ],
};

const SCENARIOS: Scenario[] = [scenarioA, scenarioB, scenarioF, scenarioC, scenarioD, scenarioE];

export interface TerminalShowcaseProps {
  /** When true, renders only inner content (e.g. inside ProductWorkbench). */
  embedded?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function TerminalShowcase({ embedded = false }: TerminalShowcaseProps) {
  const [activeId, setActiveId] = useState(SCENARIOS[0].id);
  const [phase, setPhase] = useState<Phase>('typing');
  const [typedCount, setTypedCount] = useState(0);
  const [visibleLines, setVisibleLines] = useState<Set<number>>(new Set());
  const [cursorVisible, setCursorVisible] = useState(true);
  /** Bumps on every effect cleanup so stale timeouts (Strict Mode, tab switch) never advance state. */
  const animSessionRef = useRef(0);

  const active = SCENARIOS.find((s) => s.id === activeId)!;

  function switchTab(id: string) {
    if (id === activeId) return;
    setActiveId(id);
    setTypedCount(0);
    setVisibleLines(new Set());
    setPhase('typing');
  }

  useEffect(() => {
    const t = setInterval(() => setCursorVisible((v) => !v), 530);
    return () => clearInterval(t);
  }, []);

  /**
   * Single driver for typing → output → done → replay.
   * Avoids multiple useEffects that fight React Strict Mode (dev double-mount clears
   * nested timeouts and left the UI frozen at `$` with no command typing).
   */
  useEffect(() => {
    const sessionId = ++animSessionRef.current;
    const isLive = () => animSessionRef.current === sessionId;

    const pending = new Set<ReturnType<typeof setTimeout>>();

    const schedule = (fn: () => void, ms: number) => {
      const id = setTimeout(() => {
        pending.delete(id);
        if (!isLive()) return;
        fn();
      }, ms);
      pending.add(id);
    };

    const clearPending = () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };

    const scenario = SCENARIOS.find((s) => s.id === activeId)!;
    const cmd = scenario.command;

    const runFullCycle = () => {
      if (!isLive()) return;
      setPhase('typing');
      setTypedCount(0);
      setVisibleLines(new Set());

      let i = 0;
      const typeStep = () => {
        if (!isLive()) return;
        if (i < cmd.length) {
          i += 1;
          setTypedCount(i);
          schedule(typeStep, TYPING_SPEED_MS);
        } else {
          schedule(startOutput, 380);
        }
      };

      const startOutput = () => {
        if (!isLive()) return;
        setPhase('output');
        scenario.lines.forEach((line) => {
          schedule(() => {
            if (!isLive()) return;
            setVisibleLines((prev) => new Set(prev).add(line.id));
          }, line.delayMs);
        });
        const lastDelay =
          scenario.lines.length > 0 ? scenario.lines[scenario.lines.length - 1].delayMs : 0;
        schedule(() => {
          if (!isLive()) return;
          setPhase('done');
          schedule(runFullCycle, REPLAY_DELAY_MS);
        }, lastDelay + 700);
      };

      schedule(typeStep, TYPING_SPEED_MS);
    };

    // Use the same `schedule` helper (setTimeout) so the kickoff is tracked in `pending`
    // and cleared on unmount. `queueMicrotask` is not cancelled by cleanup — combined with
    // React Strict Mode in dev, the first microtask could run after the remount session bump
    // and leave the terminal stuck at `$` with no typing.
    schedule(() => {
      if (!isLive()) return;
      runFullCycle();
    }, 0);

    return () => {
      clearPending();
      animSessionRef.current += 1;
    };
  }, [activeId]);

  const cursor = (
    <span
      style={{
        display: 'inline-block',
        width: '2px',
        height: '0.85em',
        backgroundColor: C.prompt,
        verticalAlign: 'text-bottom',
        opacity: cursorVisible ? 1 : 0,
        transition: 'opacity 0.06s',
      }}
    />
  );

  const heading = (
    <div className="text-center mb-2 sm:mb-2.5">
      <span className="inline-block text-xs font-mono font-semibold tracking-widest uppercase text-primary bg-primary/10 border border-primary/20 px-3 py-1 rounded-full mb-1.5">
        Live Demo
      </span>
      <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tighter mb-1.5">
        See the API in Action
      </h2>
      <p className="text-zinc-400 max-w-2xl mx-auto text-base leading-relaxed px-1">
        Stylized demos (not live recordings) — REST and SDK shapes match the API; CLI &apos;agent&apos; and some MCP
        tool names illustrate product workflows. Use{' '}
        <span className="text-zinc-300">riskmodels --help</span> and MCP{' '}
        <span className="text-zinc-300">tools/list</span> for what your install actually exposes. Python SDK:{' '}
        <a
          href="https://pypi.org/project/riskmodels-py/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          PyPI
        </a>
        {' · '}
        <a
          href="https://github.com/Cerebellum-Archive/RiskModels_API/tree/main/sdk"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          source (sdk/)
        </a>
        .
      </p>
    </div>
  );

  const terminalChrome = embedded
    ? `${jetbrains.className} relative z-10 isolate max-w-full min-w-0 rounded-xl overflow-hidden border border-white/10 bg-[#06080c]/95 ring-1 ring-white/[0.04]`
    : `${jetbrains.className} relative z-10 isolate max-w-full min-w-0 rounded-2xl overflow-hidden border border-white/10 bg-zinc-950/70 backdrop-blur-md shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_25px_80px_-20px_rgba(0,0,0,0.65),0_0_100px_-30px_rgba(59,130,246,0.25)] ring-1 ring-white/5`;

  const terminal = (
    <div className={terminalChrome}>
          {/* macOS title bar */}
          <div
            className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-3 border-b border-white/10 select-none bg-zinc-950/80 min-w-0"
          >
            {/* Traffic lights */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="block w-3 h-3 rounded-full" style={{ backgroundColor: '#FF5F57' }} />
              <span className="block w-3 h-3 rounded-full" style={{ backgroundColor: '#FEBC2E' }} />
              <span className="block w-3 h-3 rounded-full" style={{ backgroundColor: '#28C840' }} />
            </div>

            {/* Centered title */}
            <span
              className="flex-1 text-center text-xs font-mono truncate"
              style={{ color: '#7a8fab' }}
            >
              {active.titleBarLabel}
            </span>

            {/* Right-aligned context badge */}
            <span
              className="flex-shrink-0 text-[10px] font-mono px-2 py-0.5 rounded border"
              style={{
                color: '#6b8aaa',
                backgroundColor: '#0b1018',
                borderColor: '#1e2d3d',
              }}
            >
              {active.contextBadge}
            </span>
          </div>

          {/* Tab bar */}
          <div
            className="flex overflow-x-auto border-b border-white/10 bg-zinc-900/90 max-w-full min-w-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {SCENARIOS.map((scenario) => (
              <button
                type="button"
                key={scenario.id}
                onClick={() => switchTab(scenario.id)}
                className={`flex-shrink-0 px-4 py-2.5 text-xs font-mono font-medium transition-colors border-b-2 whitespace-nowrap ${
                  activeId === scenario.id
                    ? 'text-primary border-primary bg-primary/5'
                    : 'text-zinc-500 border-transparent hover:text-zinc-300 hover:border-zinc-700'
                }`}
              >
                {scenario.label}
              </button>
            ))}
          </div>

          {/* Terminal body — key resets subtree when switching scenarios (line ids repeat per tab). */}
          <div
            key={activeId}
            className="px-3 sm:px-6 pt-5 pb-7 text-sm leading-[1.7] overflow-x-auto overflow-y-visible bg-[#0B0E14] text-left max-w-full min-w-0"
            style={{ minHeight: 'min(340px, 52vh)' }}
          >
            {/* Prompt + typed command */}
            <div className="flex items-baseline gap-2 whitespace-nowrap">
              <span style={{ color: C.prompt, userSelect: 'none' }}>$</span>
              <span style={{ color: C.bright }}>
                {active.command.slice(0, typedCount)}
                {phase === 'typing' && <span style={{ marginLeft: '1px' }}>{cursor}</span>}
              </span>
            </div>

            {/* Output lines */}
            <div className="mt-1.5 space-y-px">
              {active.lines.map((line) => (
                <div
                  key={`${activeId}-${line.id}`}
                  style={{
                    opacity: visibleLines.has(line.id) ? 1 : 0,
                    transform: visibleLines.has(line.id) ? 'translateX(0)' : 'translateX(-5px)',
                    transition: 'opacity 0.18s ease-out, transform 0.18s ease-out',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {line.content}
                </div>
              ))}
            </div>

            {/* Idle cursor after sequence completes */}
            {phase === 'done' && (
              <div className="flex items-baseline gap-2 mt-2">
                <span style={{ color: C.prompt, userSelect: 'none' }}>$</span>
                {cursor}
              </div>
            )}
          </div>
    </div>
  );

  if (embedded) {
    return (
      <div className="w-full min-w-0">
        {heading}
        {terminal}
      </div>
    );
  }

  return (
    <section className="relative w-full z-[3] bg-zinc-950 px-4 py-16 sm:px-6 lg:px-8">
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-zinc-950 to-transparent"
        aria-hidden
      />
      <div className="relative max-w-5xl mx-auto min-w-0">
        {heading}
        {terminal}
      </div>
    </section>
  );
}
