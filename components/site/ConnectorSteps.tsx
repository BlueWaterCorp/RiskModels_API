import { CopyButton } from './CopyButton';
import { FIRST_LIVE_PROMPT_MCP } from '@/lib/mcp/activation';

export const MCP_CLAUDE_URL = 'https://riskmodels.app/api/mcp/sse';

/** The connector address and the first prompt, each with a copy control. */
export function ConnectorSteps() {
  return (
    <ol className="divide-y divide-[var(--rm-rule)] border-y border-rule">
      <li className="grid gap-2 py-4 sm:grid-cols-[2rem_1fr]">
        <span className="rm-label pt-0.5">1</span>
        <div className="min-w-0">
          <p className="text-[0.9375rem] text-ink">
            In Claude, open Settings, then Connectors, then Add custom connector, and paste this address.
          </p>
          <div className="mt-2 flex min-w-0 items-center gap-2">
            <code className="rm-mono min-w-0 flex-1 truncate text-[0.8125rem] text-ink">{MCP_CLAUDE_URL}</code>
            <CopyButton text={MCP_CLAUDE_URL} label="Copy address" />
          </div>
        </div>
      </li>
      <li className="grid gap-2 py-4 sm:grid-cols-[2rem_1fr]">
        <span className="rm-label pt-0.5">2</span>
        <p className="text-[0.9375rem] text-ink">
          Choose Connect, sign in once and approve. No API key is pasted; the tools load after approval.
        </p>
      </li>
      <li className="grid gap-2 py-4 sm:grid-cols-[2rem_1fr]">
        <span className="rm-label pt-0.5">3</span>
        <div className="min-w-0">
          <p className="text-[0.9375rem] text-ink">Send a first prompt that calls the data tools.</p>
          <p className="rm-mono mt-2 text-[0.8125rem] leading-6 text-ink-muted">{FIRST_LIVE_PROMPT_MCP}</p>
          <CopyButton text={FIRST_LIVE_PROMPT_MCP} label="Copy prompt" className="mt-2" />
        </div>
      </li>
    </ol>
  );
}
