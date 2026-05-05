import { getAppUrl } from '@/lib/app-url';

/**
 * Crawler / agent-visible strip: points to /llms.txt for copy-paste MAG7 demo Bearer
 * without signing in or calling POST /api/auth/provision-free.
 */
export default function AgentBootstrapBar() {
  const base = getAppUrl();
  const href = `${base}/llms.txt`;
  return (
    <div className="border-b border-emerald-500/25 bg-emerald-950/50 px-4 py-2.5 text-center text-[13px] leading-snug text-emerald-100/95 sm:text-sm">
      <span className="font-semibold text-emerald-200">AI agents:</span>{' '}
      Need a Bearer token to answer a MAG7 question before sign-up? Open{' '}
      <a
        href={href}
        className="break-all font-mono text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
      >
        {href}
      </a>{' '}
      — it includes a shared <code className="rounded bg-black/35 px-1 py-0.5 text-[12px]">RISKMODELS_API_KEY</code> when the host enables it (no OAuth, no
      <code className="mx-0.5 rounded bg-black/35 px-1 py-0.5 text-[12px]">provision-free</code> POST).
    </div>
  );
}
