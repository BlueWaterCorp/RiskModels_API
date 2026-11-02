'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Input } from '@/components/ui/Input';
import { FEED_INTENDED_USES } from '@/lib/feed-waitlist';

type Status = 'idle' | 'submitting' | 'done' | 'error';

const labelClass = 'block text-xs font-medium text-zinc-400 mb-1';

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
          name: form.get('name'),
          company: form.get('company'),
          role: form.get('role'),
          intended_use: form.get('intended_use') || null,
          consent_feed_emails: form.get('consent_feed_emails') === 'on',
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
          Work email <span className="text-blue-400">*</span>
        </label>
        <Input id="fw-email" name="email" type="email" required autoComplete="email" maxLength={254} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="fw-name" className={labelClass}>
            Name
          </label>
          <Input id="fw-name" name="name" autoComplete="name" maxLength={200} />
        </div>
        <div>
          <label htmlFor="fw-company" className={labelClass}>
            Company
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
          <label htmlFor="fw-use" className={labelClass}>
            Intended use
          </label>
          <select
            id="fw-use"
            name="intended_use"
            defaultValue=""
            className="flex h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-colors"
          >
            <option value="">Select…</option>
            {FEED_INTENDED_USES.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Honeypot: hidden from people and assistive tech; bots tend to fill it. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="fw-website">Website</label>
        <input id="fw-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <label className="flex items-start gap-2 text-sm text-zinc-300 leading-snug">
        <input
          type="checkbox"
          name="consent_feed_emails"
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-600 bg-zinc-900 accent-blue-500"
        />
        <span>
          Email me about the security master feed: launch notice, the spec and sample, and editions
          once delivery starts. We will send a link to confirm your address first. Unsubscribe at any time.
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
        We use these details only to contact you about the feed. See the{' '}
        <Link href="/privacy" className="underline hover:text-zinc-300">
          privacy policy
        </Link>
        .
      </p>
    </form>
  );
}
