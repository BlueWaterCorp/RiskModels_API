import Link from "next/link";

/**
 * Quickstart step 1 — no public "demo key"; MAG7 tickers are unauthenticated via GET /tickers?mag7=true.
 */
export default function QuickstartApiKeyCallout() {
  return (
    <div className="mb-6 rounded-xl border border-amber-500/35 bg-amber-500/10 p-4 shadow-sm shadow-amber-950/20 ring-1 ring-amber-500/15">
      <p className="text-sm font-semibold text-amber-200">API keys look like rm_user_* or rm_agent_*</p>
      <p className="mt-2 text-xs text-zinc-400">
        There is no separate public demo secret — older <code className="rounded bg-zinc-900 px-1 text-zinc-300">rm_demo_*</code>{" "}
        strings are not valid Bearer credentials. Try the public MAG7 list:{" "}
        <code className="rounded bg-zinc-900 px-1 text-zinc-300">
          curl &quot;https://riskmodels.app/api/tickers?mag7=true&quot;
        </code>
      </p>
      <p className="mt-2 text-xs text-zinc-500">
        For metrics, balance, and the examples below, create a key on{" "}
        <Link href="/get-key" className="text-amber-200/90 underline hover:text-amber-100">
          Get key
        </Link>
        .
      </p>
    </div>
  );
}
