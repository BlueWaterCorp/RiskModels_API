/** Canonical onboarding copy and decisions. Mirror into RiskModels_API/emails/. */
export const WORKFLOWS = ['agent', 'python', 'rest', 'exploring'] as const;
export type SetupWorkflow = (typeof WORKFLOWS)[number];
export const AGENT_CLIENTS = ['claude', 'chatgpt', 'codex', 'cursor', 'other'] as const;
export type AgentClient = (typeof AGENT_CLIENTS)[number];
export const WORKFLOW_LABELS: Record<SetupWorkflow, string> = {
  agent: 'AI assistant', python: 'Python / research notebook',
  rest: 'REST API / building an application', exploring: 'Just exploring',
};
export function parseWorkflow(value: unknown): SetupWorkflow | null {
  return WORKFLOWS.includes(value as SetupWorkflow) ? value as SetupWorkflow : null;
}
export function parseAgentClient(value: unknown): AgentClient | null {
  return AGENT_CLIENTS.includes(value as AgentClient) ? value as AgentClient : null;
}
export function setupExample(workflow: SetupWorkflow, client: AgentClient | null = null) {
  const base = 'https://riskmodels.app';
  if (workflow === 'python') return {
    title: 'Run your first analysis in Python', url: `${base}/installation`,
    instruction: 'Install riskmodels-py and set RISKMODELS_API_KEY in your environment. Then run:',
    code: 'from riskmodels import RiskModelsClient\nclient = RiskModelsClient.from_env()\nprint(client.get_metrics("NVDA"))',
    expected: 'Look for the market, sector, subsector and residual risk measures. Replace NVDA with a stock you follow.',
  };
  if (workflow === 'rest') return {
    title: 'Make your first API request', url: `${base}/api-docs.html`,
    instruction: 'Set RISKMODELS_API_KEY in your environment, then run:',
    code: 'curl --fail-with-body "https://riskmodels.app/api/metrics/NVDA" \\\n  -H "Authorization: Bearer $RISKMODELS_API_KEY"',
    expected: 'You should receive JSON containing NVDA risk metrics. Replace NVDA with a stock you follow.',
  };
  if (workflow === 'agent') return {
    title: `Run your first analysis${client && client !== 'other' ? ` in ${({ claude: 'Claude', chatgpt: 'ChatGPT', codex: 'Codex', cursor: 'Cursor' })[client]}` : ' with your AI assistant'}`,
    url: `${base}/docs/agent-integration${client === 'chatgpt' ? '#chatgpt-mcp' : client === 'claude' || client === 'cursor' ? '#mcp-setup' : ''}`,
    instruction: client === 'claude'
      ? 'In Claude, add a custom connector using https://riskmodels.app/api/mcp/sse and sign in. Then paste:'
      : client === 'chatgpt'
        ? 'Follow the ChatGPT connection steps in the setup guide. Once RiskModels is connected, paste:'
        : client === 'codex'
          ? 'Follow the Codex connection steps in the setup guide. Once RiskModels is connected, paste:'
          : client === 'cursor'
            ? 'Follow the Cursor connection steps in the setup guide. Once RiskModels is connected, paste:'
            : 'Choose your assistant in the setup guide and connect RiskModels. Then paste:',
    code: 'Use RiskModels to compare AAPL and NVDA. Explain their market, sector, subsector and residual risk using the live tool results.',
    expected: 'Your assistant should call RiskModels and explain the returned numbers. Replace the tickers with stocks you follow.',
  };
  return {
    title: 'Choose a first analysis', url: `${base}/installation`,
    instruction: 'Choose an AI assistant, Python or REST in the setup guide. Start by comparing two stocks you follow.',
    code: '', expected: 'You can examine market, sector, subsector and residual risk. Reply with what you want to analyze and Conrad will help you choose a starting point.',
  };
}

export type EngagementKind = 'setup-help' | 'setup-example' | 'error-help' | 'return-help' | 'workflow-help' | 'reconnect';
export interface EngagementAccount {
  user_id: string; email: string | null; full_name: string | null;
  workflow: SetupWorkflow; agent_client: AgentClient | null;
  started_at: string; paused_at: string | null; pause_reason: string | null;
  last_contact_at: string | null; last_reply_at: string | null;
  excluded: boolean; has_active_key: boolean; account_status: string | null;
  first_success_at: string | null; last_success_at: string | null;
  success_count: number; successful_days: number;
  last_error_at: string | null; last_error_status: string | null;
  paid_credits_usd: number; sent_kinds: EngagementKind[];
  has_pending_send: boolean;
}
const DAY = 86_400_000;
/** Review queue suggestions only. Re-evaluate immediately before any send. */
export function nextEngagement(account: EngagementAccount, now = Date.now()): EngagementKind | null {
  if (!account.email || account.excluded || !account.has_active_key ||
      account.account_status !== 'active' || account.paused_at || account.last_reply_at || account.has_pending_send) return null;
  if (account.last_contact_at && now - Date.parse(account.last_contact_at) < 3 * DAY) return null;
  const sent = new Set(account.sent_kinds);
  // At most two unanswered follow-ups across the whole account, not per key or branch.
  if (sent.size >= 2) return null;
  const age = now - Date.parse(account.started_at);
  if (!Number.isFinite(age) || age < 0) return null;
  if (account.last_error_at && (!account.last_success_at || account.last_error_at > account.last_success_at)
      && now - Date.parse(account.last_error_at) < 7 * DAY && !sent.has('error-help')) return 'error-help';
  if (account.successful_days >= 2) {
    return account.last_success_at && now - Date.parse(account.last_success_at) < 7 * DAY && !sent.has('workflow-help')
      ? 'workflow-help' : null;
  }
  if (account.first_success_at) {
    return account.last_success_at && now - Date.parse(account.last_success_at) >= 7 * DAY && !sent.has('return-help')
      ? 'return-help' : null;
  }
  if (age > 21 * DAY) return !sent.has('reconnect') ? 'reconnect' : null;
  if (age >= 5 * DAY && sent.has('setup-help') && !sent.has('setup-example')) return 'setup-example';
  if (age >= 2 * DAY && !sent.has('setup-help')) return 'setup-help';
  return null;
}

export function greetingName(fullName: string | null | undefined): string {
  const name = fullName?.trim();
  if (!name || /^(testing user|test user|test|user|unknown|undefined|null)$/i.test(name)) return 'there';
  return name.split(/\s+/)[0];
}

export function engagementCopy(account: EngagementAccount, kind: EngagementKind) {
  const greeting = `Hi ${greetingName(account.full_name)},`;
  const example = setupExample(account.workflow, account.agent_client);
  const content: Record<EngagementKind, { subject: string; paragraphs: string[] }> = {
    'setup-help': { subject: 'Getting started with RiskModels', paragraphs: [
      'Conrad here, founder of RiskModels. Were you able to get your first analysis running?',
      'If setup got in the way, reply with the tool you are using and any error message. Please leave out API keys or other credentials. I will help you get it working.',
      'What were you hoping to analyze first?',
    ] },
    'setup-example': { subject: 'A starting point for your RiskModels analysis', paragraphs: [
      'Here is a starting point you can adapt to a stock you follow.', example.instruction,
      ...(example.code ? [example.code] : []), example.expected, `Setup guide: ${example.url}`,
      'If you would like help applying this to your question, reply here. I will leave the follow-ups here unless you get back in touch.',
    ] },
    'error-help': { subject: 'Help with your RiskModels request', paragraphs: [
      'It looks like a recent RiskModels request did not complete successfully. Were you able to resolve it?',
      'Reply with what you were trying to do and the error message, leaving out API keys or other credentials. I will help you work through it.',
    ] },
    'return-help': { subject: 'Did RiskModels answer your question?', paragraphs: [
      'Did the analysis give you what you needed?',
      'I would be interested to know what you are trying to do next. If you want to run this across a fund list or portfolio, I can help you put together a reusable example.',
    ] },
    'workflow-help': { subject: 'Making RiskModels part of your workflow', paragraphs: [
      'What are you building with RiskModels?',
      'If you are planning to use it regularly, I can help with batching, refresh schedules and estimating API costs. Reply with your intended workflow and I will suggest a concrete next step.',
    ] },
    'reconnect': { subject: 'Your RiskModels project', paragraphs: [
      'You previously set up access to RiskModels. Is the project you had in mind still on your list?',
      'If you would like to pick it up, reply with what you wanted to analyze and the tool you use. I can help you find a starting point.',
    ] },
  };
  return { subject: content[kind].subject, text: [greeting, ...content[kind].paragraphs, 'Best,\nConrad'].join('\n\n') };
}
