'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Input } from '@/components/ui/Input';
import {
  FEED_AUDIENCES,
  FEED_FIRM_SIZES,
  FEED_FIRM_TYPES,
  FEED_INTENDED_USES,
  FEED_USES,
} from '@/lib/feed-waitlist';

type Status = 'idle' | 'submitting' | 'done' | 'error';

const labelClass = 'block text-xs font-medium text-zinc-400 mb-1';
const selectClass =
  'flex h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-colors';
const boxClass = 'mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-600 bg-zinc-900 accent-blue-500';

/** Referral code from a "Forward to a colleague" link (?ref=...). Read at submit; never shown. */
function referralCode(): string | null {
  try {
    const ref = new URLSearchParams(window.location.search).get('ref');
    return ref && /^[a-z0-9]{8,32}$/.test(ref) ? ref : null;
  } catch {
    return null;
  }
}

export default function FeedWaitlistForm() {
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setStatus('submitting');
    setMessage(null);
    try {
      const res = await fetch('/api/feed-waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.get('email'),
          feed_email: form.get('feed_email'),
          name: form.get('name'),
          company: form.get('company'),
          role: form.get('role'),
          intended_use: form.get('intended_use') || null,
          firm_type: form.get('firm_type') || null,
          firm_size: form.get('firm_size') || null,
          uses: form.getAll('uses'),
          audience: form.get('audience') || null,
          heard_about: form.get('heard_about'),
          consent_feed_emails: form.get('consent_feed_emails') === 'on',
          marketing_opt_in: form.get('marketing_opt_in') === 'on',
          terms_accepted: form.get('terms_accepted') === 'on',
          ref: referralCode(),
          website: form.get('website'),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setStatus('error');
        setMessage(json.message ?? 'Could not record your signup. Please retry shortly.');
        return;
      }
      setStatus('done');
      setMessage(json.message ?? 'Thank you. Check your email to confirm.');
    } catch {
      setStatus('error');
      setMessage('Could not reach the server. Please retry shortly.');
    }
  }

  if (status === 'done') {
    return (
      <div
        role="status"
        className="rounded-lg border border-green-400/20 bg-green-400/10 px-4 py-3 text-sm text-green-300"
      >
        {message}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <label htmlFor="fw-email" className={labelClass}>
          Your email <span className="text-blue-400">*</span>
        </label>
        <Input id="fw-email" name="email" type="email" required autoComplete="email" maxLength={254} />
      </div>
      <div>
        <label htmlFor="fw-feed-email" className={labelClass}>
          Send the feed to a different address <span className="text-zinc-500">(optional)</span>
        </label>
        <Input id="fw-feed-email" name="feed_email" type="email" autoComplete="off" maxLength={254} />
        <p className="mt-1 text-[11px] text-zinc-500 leading-snug">
          Many teams use one address for the person and another for the feed, such as a team mailbox or an agent
          inbox. We will ask that address to confirm too. Leave blank to receive everything at the address above.
        </p>
      </div>

      <p className="pt-1 text-[11px] text-zinc-500">Everything below is optional except the terms box.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="fw-name" className={labelClass}>
            Name
          </label>
          <Input id="fw-name" name="name" autoComplete="name" maxLength={200} />
        </div>
        <div>
          <label htmlFor="fw-company" className={labelClass}>
            Firm
          </label>
          <Input id="fw-company" name="company" autoComplete="organization" maxLength={200} />
        </div>
        <div>
          <label htmlFor="fw-role" className={labelClass}>
            Role
          </label>
          <Input id="fw-role" name="role" autoComplete="organization-title" maxLength={200} />
        </div>
        <div>
          <label htmlFor="fw-firm-type" className={labelClass}>
            Firm type
          </label>
          <select id="fw-firm-type" name="firm_type" defaultValue="" className={selectClass}>
            <option value="">Select…</option>
            {FEED_FIRM_TYPES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="fw-firm-size" className={labelClass}>
            Firm size (assets under management)
          </label>
          <select id="fw-firm-size" name="firm_size" defaultValue="" className={selectClass}>
            <option value="">Select…</option>
            {FEED_FIRM_SIZES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="fw-use" className={labelClass}>
            Main area
          </label>
          <select id="fw-use" name="intended_use" defaultValue="" className={selectClass}>
            <option value="">Select…</option>
            {FEED_INTENDED_USES.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset>
        <legend className={labelClass}>What would you use it for? (any that apply)</legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {FEED_USES.map((u) => (
            <label key={u.value} className="flex items-start gap-2 text-sm text-zinc-300 leading-snug">
              <input type="checkbox" name="uses" value={u.value} className={boxClass} />
              <span>{u.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className={labelClass}>Who will read it?</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {FEED_AUDIENCES.map((a) => (
            <label key={a.value} className="flex items-center gap-2 text-sm text-zinc-300">
              <input type="radio" name="audience" value={a.value} className="h-4 w-4 accent-blue-500" />
              <span>{a.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="fw-heard" className={labelClass}>
          How did you hear about it?
        </label>
        <Input id="fw-heard" name="heard_about" maxLength={200} />
      </div>

      {/* Honeypot: hidden from people and assistive tech; bots tend to fill it. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="fw-website">Website</label>
        <input id="fw-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <label className="flex items-start gap-2 text-sm text-zinc-300 leading-snug">
        <input type="checkbox" name="consent_feed_emails" className={boxClass} />
        <span>
          Email me the feed: launch notice, the spec and sample, and editions once delivery starts. We will send a
          link to confirm your address first. Unsubscribe at any time.
        </span>
      </label>

      <label className="flex items-start gap-2 text-sm text-zinc-300 leading-snug">
        <input type="checkbox" name="marketing_opt_in" className={boxClass} />
        <span>
          Also send me occasional news about other RiskModels products. Separate from the feed; it takes effect only
          once you confirm your address, and you can stop it at any time.
        </span>
      </label>

      <label className="flex items-start gap-2 text-sm text-zinc-300 leading-snug">
        <input type="checkbox" name="terms_accepted" required className={boxClass} />
        <span>
          I accept the{' '}
          <Link href="/legal/feed-terms" className="underline hover:text-white" target="_blank">
            free edition terms
          </Link>
          : use inside my firm and quoting with attribution; no bulk redistribution or resale.{' '}
          <span className="text-blue-400">*</span>
        </span>
      </label>

      <button
        type="submit"
        disabled={status === 'submitting'}
        className="inline-flex w-full items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60 transition-colors sm:w-auto"
      >
        {status === 'submitting' ? 'Joining…' : 'Join the early-access list'}
      </button>

      {status === 'error' && message && (
        <p role="alert" className="text-sm text-orange-400">
          {message}
        </p>
      )}
      <p className="text-[11px] text-zinc-500 leading-snug">
        We use these details to run the feed and to understand who reads it. See the{' '}
        <Link href="/privacy" className="underline hover:text-zinc-300">
          privacy policy
        </Link>
        .
      </p>
    </form>
  );
}
