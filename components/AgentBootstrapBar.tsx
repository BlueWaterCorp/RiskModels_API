import { getAppUrl } from '@/lib/app-url';

/**
 * @deprecated
 * Previously rendered on the homepage. Agent bootstrap information now lives primarily in
 * /llms.txt (and secondarily in the API reference "For AI Agents & MCP" section).
 *
 * Keeping the component for now in case we want a subtle version on docs pages later.
 */
export default function AgentBootstrapBar() {
  const base = getAppUrl();
  const href = `${base}/llms.txt`;
  return (
    <div className="border-b border-zinc-800 bg-zinc-950 px-4 py-1.5 text-center text-[11px] leading-tight text-zinc-500 sm:text-xs">
      <span className="font-medium text-zinc-400">AI agents:</span>{' '}
      For quick MAG7 demos without sign-up, see{' '}
      <a
        href={href}
        className="font-mono text-zinc-400 underline underline-offset-2 hover:text-zinc-300"
      >
        {href}
      </a>
      {' '}— contains a shared demo key when enabled.
    </div>
  );
}
