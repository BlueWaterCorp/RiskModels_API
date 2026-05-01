'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';
import { Copy, Check, Sparkles, Share2, BookOpen, AlertCircle } from 'lucide-react';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';

type AffiliateStats = {
  referred_key_count: number;
  referred_user_count: number;
  total_revenue_usd: number;
  commission_earned_usd: number;
  total_paid_out_usd: number;
  balance_owed_usd: number;
};

type AffiliatePayload = {
  id: string;
  referral_code: string;
  status: string;
  commission_rate: number;
  payout_email: string | null;
  /** True until affiliate consents to current terms via banner or email-reply. */
  consent_required: boolean;
  stats: AffiliateStats;
};

const TERMS_VERSION = 'v1.1';
const TERMS_URL = 'https://riskmodels.net/terms/affiliate';

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const click = () => {
    void copyTextToClipboard(text).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    });
  };
  return (
    <button
      onClick={click}
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-mono text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
      title={label}
    >
      {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
      {copied ? 'Copied' : label}
    </button>
  );
}

function fmtUsd(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(n);
}

const COMMUNITIES = [
  {
    name: 'r/algotrading',
    url: 'https://reddit.com/r/algotrading',
    why: 'Active 600k-member quant community. Mods enforce no-spam strictly — lead with signal, not your link.',
  },
  {
    name: 'r/quant',
    url: 'https://reddit.com/r/quant',
    why: '60k members; smaller but higher-signal. Best for L3 / hedge-ratio / factor-decomposition content.',
  },
  {
    name: 'FinTwit (X / Twitter)',
    url: 'https://x.com/search?q=fintwit',
    why: 'Quote a chart you generated with the SDK. Tag the relevant thinkers. Fastest signal-to-engagement of all channels.',
  },
  {
    name: 'LinkedIn — quant analyst groups',
    url: 'https://linkedin.com',
    why: 'For sell-side and buy-side analysts. Frame posts as "what I learned" with one chart, then link to the gist.',
  },
  {
    name: 'Wilmott Forums',
    url: 'https://forum.wilmott.com',
    why: 'Old-school but high-quality. Best for risk-decomposition deep dives. Read the FAQ before your first post.',
  },
  {
    name: 'QuantNet',
    url: 'https://quantnet.com',
    why: 'MFE community — students and early-career quants. Tutorial / "how I learned this" framing performs best.',
  },
];

const CONTENT_IDEAS = [
  {
    title: "What's actually driving NVDA's risk this week?",
    hook: 'Beta tells you NVDA moves with the market. The L3 decomposition tells you *what specifically* — sector rotation vs idiosyncratic vs subsector.',
    snippet: `from riskmodels import RiskModelsClient
client = RiskModelsClient(api_key="rm_agent_live_...")

m = client.get_metrics("NVDA")
print(f"Market HR: {m['l3_market_hr']:.2f}  ER: {m['l3_market_er']:.0%}")
print(f"Sector HR: {m['l3_sector_hr']:.2f}  ER: {m['l3_sector_er']:.0%}")
print(f"Subsector HR: {m['l3_subsector_hr']:.2f}  ER: {m['l3_subsector_er']:.0%}")
print(f"Residual ER: {m['l3_residual_er']:.0%}")`,
  },
  {
    title: "The hidden sector bet in my 'diversified' tech basket",
    hook: 'Equal-weight 5 names that all live in the same L3 subsector and you have a concentrated bet, not diversification. Show the receipts.',
    snippet: `risk = client.analyze_portfolio([
  {"ticker": "NVDA", "weight": 0.20},
  {"ticker": "AMD",  "weight": 0.20},
  {"ticker": "MU",   "weight": 0.20},
  {"ticker": "AVGO", "weight": 0.20},
  {"ticker": "MRVL", "weight": 0.20},
])
print(risk["portfolio_subsector_er"])  # — likely 60–80%`,
  },
  {
    title: 'Why my hedge ratio matters more than my beta',
    hook: 'Standard CAPM beta uses raw OLS. The L3 hedge ratio decomposes by market / sector / subsector — so the residual is what you actually picked.',
    snippet: `# Compare across 5 mainstream names
for t in ["AAPL", "JPM", "XOM", "TSLA", "WMT"]:
    m = client.get_metrics(t)
    print(f"{t}: market_hr={m['l3_market_hr']:.2f}  residual_er={m['l3_residual_er']:.0%}")`,
  },
  {
    title: 'Daily 5-minute risk dashboard for my watchlist',
    hook: "Dump 10–20 tickers into a notebook each morning. teo + L3 explains 90% of what you'd skim a research report for.",
    snippet: `tickers = ["NVDA", "AAPL", "MSFT", "AMZN", "META", "GOOGL", "TSLA", "JPM", "XOM", "WMT"]
import pandas as pd
df = pd.DataFrame([client.get_metrics(t) for t in tickers], index=tickers)
df[["teo", "l3_market_hr", "l3_subsector_er", "l3_residual_er"]]`,
  },
  {
    title: 'Backtesting my portfolio against macro factors',
    hook: 'Most retail dashboards stop at single-name beta. Show how the same portfolio loaded onto VIX / oil / inflation 12 months ago vs today.',
    snippet: `series = client.get_macro_factor_series("NVDA")
# returns DataFrame with daily loadings vs VIX, inflation, oil, USD
series[["vix_loading", "inflation_loading", "oil_loading"]].tail(252).plot()`,
  },
];

const POSTING_BEST_PRACTICES = [
  {
    title: 'Lead with signal, not your link',
    body: 'The chart / number / one-liner takeaway goes in the post body. The referral link goes in the *first comment* (Reddit/LinkedIn) or as the second tweet in a thread. Most communities ban posts that lead with a link.',
  },
  {
    title: 'Disclose the affiliate relationship',
    body: 'A one-liner like "(I get a referral credit if you sign up)" at the bottom of the post or comment. Builds trust, complies with FTC guidelines, and is what every solid creator does.',
  },
  {
    title: 'Reuse, don\'t spam',
    body: 'One post per community per week is plenty. The same content idea works across r/algotrading, FinTwit, and LinkedIn — just retitle and reframe for each audience.',
  },
  {
    title: 'Reply, don\'t broadcast',
    body: 'When someone in the comments asks "how would you do X with this?", that\'s your highest-leverage content. Reply with a 5-line snippet. Those replies convert better than the original post.',
  },
];

function AffiliateDashboard() {
  const supabase = createClient();
  const [user, setUser] = useState<User | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [data, setData] = useState<AffiliatePayload | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(false);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      setLoadingUser(false);
    });
    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchData = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    try {
      const res = await fetch('/api/affiliate/me');
      if (res.status === 404) {
        setData(null);
        setDataError('not-an-affiliate');
        return;
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setDataError(j.error ?? `Failed (${res.status})`);
        return;
      }
      setData((await res.json()) as AffiliatePayload);
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) void fetchData();
  }, [user, fetchData]);

  if (loadingUser) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <Sparkles size={28} className="mx-auto text-zinc-400 mb-3" />
          <h1 className="text-xl font-bold mb-2">RiskModels Affiliate Program</h1>
          <p className="text-zinc-400 text-sm mb-6">
            Sign in to see your affiliate stats, share link, and content playbook.
          </p>
          <Link
            href="/get-key"
            className="inline-block px-5 py-2.5 rounded-lg bg-zinc-100 text-zinc-900 font-semibold text-sm hover:bg-white transition-colors"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  if (dataError === 'not-an-affiliate') {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center px-4 py-16">
        <div className="max-w-md w-full text-center">
          <Sparkles size={28} className="mx-auto text-zinc-400 mb-3" />
          <h1 className="text-xl font-bold mb-2">Not an affiliate yet</h1>
          <p className="text-zinc-400 text-sm leading-relaxed mb-6">
            The RiskModels affiliate program is currently invite-only. If you write about quant
            risk, factor models, or systematic trading, reach out and we&apos;ll set you up with a
            referral code and a commission share on everyone you bring in.
          </p>
          <a
            href="mailto:service@riskmodels.app?subject=Affiliate%20program%20application"
            className="inline-block px-5 py-2.5 rounded-lg bg-zinc-100 text-zinc-900 font-semibold text-sm hover:bg-white transition-colors"
          >
            Email us about joining
          </a>
        </div>
      </div>
    );
  }

  if (dataLoading || !data) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
      </div>
    );
  }

  /** v1.1 active re-consent gate: dashboard is blocked until the affiliate
   *  resolves the banner (Accept or Pass). Re-fetches the payload after
   *  resolution so consent_required flips and the dashboard renders. */
  if (data.consent_required) {
    return <ConsentBanner onResolved={() => void fetchData()} />;
  }

  const ratePct = (data.commission_rate * 100).toFixed(data.commission_rate < 0.1 ? 1 : 0);
  const baseUrl =
    typeof window !== 'undefined' ? window.location.origin : 'https://riskmodels.app';
  const shareLink = `${baseUrl}/get-key?ref=${encodeURIComponent(data.referral_code)}`;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 py-12 px-4">
      <div className="max-w-3xl mx-auto space-y-10">
        {/* Header */}
        <header>
          <Link
            href="/get-key"
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            ← Back to API keys
          </Link>
          <div className="flex items-center gap-3 mt-3">
            <Sparkles size={22} className="text-zinc-300" />
            <h1 className="text-2xl font-bold">Affiliate dashboard</h1>
          </div>
          <p className="text-zinc-400 text-sm mt-1">{user.email}</p>
        </header>

        {/* Status banner if not active */}
        {data.status !== 'active' ? (
          <div className="rounded-xl border border-amber-700/40 bg-amber-950/20 p-4 flex items-start gap-3">
            <AlertCircle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="text-amber-200/90">
                Your affiliate status is <strong>{data.status}</strong>. New referrals won&apos;t
                attribute. Reply to{' '}
                <a href="mailto:service@riskmodels.app" className="underline">
                  service@riskmodels.app
                </a>{' '}
                if you think this is a mistake.
              </p>
            </div>
          </div>
        ) : null}

        {/* Stats */}
        <section>
          <h2 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider mb-3">
            Your stats
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Referred keys" value={String(data.stats.referred_key_count)} />
            <Stat label="Referred users" value={String(data.stats.referred_user_count)} />
            <Stat label="Revenue generated" value={fmtUsd(data.stats.total_revenue_usd)} />
            <Stat
              label="Commission earned"
              value={fmtUsd(data.stats.commission_earned_usd)}
              accent
            />
            <Stat label="Paid out" value={fmtUsd(data.stats.total_paid_out_usd)} />
            <Stat label="Balance owed" value={fmtUsd(data.stats.balance_owed_usd)} accent />
            <Stat label="Commission rate" value={`${ratePct}%`} />
            <Stat label="Status" value={data.status} />
          </div>
          <p className="text-xs text-zinc-500 mt-3 leading-relaxed">
            Payouts are processed manually right now — when your balance is meaningful, we send to{' '}
            <strong className="text-zinc-300">{data.payout_email ?? user.email}</strong>. Reply to{' '}
            <a href="mailto:service@riskmodels.app" className="text-blue-400 hover:underline">
              service@riskmodels.app
            </a>{' '}
            to set a different payout method (Wise, ACH, crypto).
          </p>
        </section>

        {/* Share link */}
        <section>
          <h2 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Share2 size={14} /> Your share link
          </h2>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-3">
            <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5">
              <code className="flex-1 text-xs sm:text-sm font-mono text-zinc-100 break-all select-all">
                {shareLink}
              </code>
              <CopyButton text={shareLink} label="Copy link" />
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Or just share the code <code className="text-zinc-300">{data.referral_code}</code>{' '}
              and tell people to enter it. Anyone who picks up an API key with your code attached
              earns you <strong className="text-zinc-300">{ratePct}%</strong> of their spend, for
              the lifetime of the key.
            </p>
          </div>
        </section>

        {/* Content ideas */}
        <section>
          <h2 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider mb-1 flex items-center gap-2">
            <BookOpen size={14} /> Playbook — content ideas
          </h2>
          <p className="text-xs text-zinc-500 mb-4 leading-relaxed">
            Each one is a post / thread / notebook you can ship in under an hour using the
            RiskModels SDK. Lead with the chart or the takeaway; drop your share link in the first
            comment.
          </p>
          <div className="space-y-3">
            {CONTENT_IDEAS.map((idea, idx) => (
              <details
                key={idx}
                className="rounded-xl border border-zinc-800 bg-zinc-900/60 group"
              >
                <summary className="cursor-pointer list-none px-4 py-3 flex items-start justify-between gap-3 hover:bg-zinc-900 rounded-xl">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-zinc-100">{idea.title}</div>
                    <div className="text-xs text-zinc-500 mt-1">{idea.hook}</div>
                  </div>
                  <span className="text-xs text-zinc-500 group-open:hidden">show snippet</span>
                  <span className="text-xs text-zinc-500 hidden group-open:inline">hide</span>
                </summary>
                <div className="px-4 pb-4">
                  <div className="rounded-lg bg-zinc-950 border border-zinc-800 p-3 mt-2">
                    <pre className="text-xs font-mono text-zinc-300 whitespace-pre-wrap overflow-x-auto">
                      {idea.snippet}
                    </pre>
                    <div className="flex justify-end mt-2">
                      <CopyButton text={idea.snippet} label="Copy snippet" />
                    </div>
                  </div>
                </div>
              </details>
            ))}
          </div>
        </section>

        {/* Where to post */}
        <section>
          <h2 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider mb-3">
            Where to post
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {COMMUNITIES.map((c) => (
              <div
                key={c.name}
                className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4"
              >
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-semibold text-zinc-100 hover:text-blue-400 transition-colors"
                >
                  {c.name}
                </a>
                <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed">{c.why}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Best practices */}
        <section>
          <h2 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider mb-3">
            Best practices
          </h2>
          <div className="space-y-3">
            {POSTING_BEST_PRACTICES.map((p, idx) => (
              <div
                key={idx}
                className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4"
              >
                <div className="text-sm font-semibold text-zinc-100">{p.title}</div>
                <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed">{p.body}</p>
              </div>
            ))}
          </div>
        </section>

        <footer className="pt-4 border-t border-zinc-800">
          <p className="text-xs text-zinc-500">
            Questions, payout method changes, want a custom landing page or a different commission
            arrangement? Reply to{' '}
            <a
              href="mailto:service@riskmodels.app"
              className="text-blue-400 hover:underline"
            >
              service@riskmodels.app
            </a>
            .
          </p>
        </footer>
      </div>
    </div>
  );
}

function ConsentBanner({
  onResolved,
}: {
  onResolved: () => void;
}) {
  const [busy, setBusy] = useState<'accept' | 'pass' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(accept: boolean) {
    setBusy(accept ? 'accept' : 'pass');
    setError(null);
    try {
      const res = await fetch('/api/affiliate/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accept, version: TERMS_VERSION }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `Failed (${res.status})`);
        return;
      }
      onResolved();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="rounded-xl border border-amber-700/40 bg-amber-950/15 p-6 sm:p-8 space-y-5">
          <div className="flex items-start gap-3">
            <AlertCircle size={22} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <h1 className="text-xl font-bold text-zinc-100">
                One thing before your dashboard loads
              </h1>
              <p className="text-sm text-zinc-400 mt-1">
                We updated the affiliate program terms (now {TERMS_VERSION}). Quick re-consent
                needed before watermarks render on charts your referrals generate.
              </p>
            </div>
          </div>

          <div className="space-y-3 text-sm text-zinc-300 leading-relaxed">
            <p>
              <strong className="text-zinc-100">What&apos;s new in {TERMS_VERSION}:</strong>
            </p>
            <ul className="list-disc pl-6 space-y-2 text-zinc-400">
              <li>
                <strong className="text-zinc-300">Perpetual license for already-published charts.</strong>{' '}
                If you opt out later, new charts stop attributing immediately, but charts already
                in the wild (Reddit posts, LinkedIn screenshots, public gists) continue to display
                your handle. We can&apos;t pull them back.
              </li>
              <li>
                <strong className="text-zinc-300">Your handle and referral code are explicitly public.</strong>{' '}
                Visible to anyone who sees a chart, not just to RiskModels.
              </li>
              <li>
                <strong className="text-zinc-300">Opt-out is always available</strong> — via this
                dashboard or via the SDK <code className="text-zinc-300">client.set_branding(False)</code>{' '}
                call. No paid tier required, no charge.
              </li>
              <li>
                <strong className="text-zinc-300">CCPA / privacy rights are clearly enumerated</strong>{' '}
                in the privacy notice. California users get a &ldquo;Do Not Share&rdquo; pathway.
              </li>
            </ul>
            <p>
              Full text:{' '}
              <a
                href={TERMS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                {TERMS_URL.replace(/^https?:\/\//, '')}
              </a>
            </p>
          </div>

          {error ? (
            <p className="text-sm text-red-400 bg-red-950/30 border border-red-800/40 rounded px-3 py-2">
              {error}
            </p>
          ) : null}

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void submit(true)}
              className="flex-1 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold text-sm transition-colors"
            >
              {busy === 'accept' ? 'Saving…' : `I accept ${TERMS_VERSION}`}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void submit(false)}
              className="flex-1 px-5 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-40 text-zinc-200 font-semibold text-sm transition-colors"
            >
              {busy === 'pass' ? 'Saving…' : 'Pass — opt out for now'}
            </button>
          </div>

          <p className="text-xs text-zinc-500 leading-relaxed">
            Either choice is reversible — you can flip your decision any time from this dashboard.
            Choosing &quot;pass&quot; suppresses chart watermarks but keeps your referral code and
            commission tracking active.
          </p>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div
        className={'mt-1.5 text-lg font-semibold ' + (accent ? 'text-emerald-400' : 'text-zinc-100')}
      >
        {value}
      </div>
    </div>
  );
}

export default function AffiliateDashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
        </div>
      }
    >
      <AffiliateDashboard />
    </Suspense>
  );
}
