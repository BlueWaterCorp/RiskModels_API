'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getConsent, inConsentRegion, setConsent } from '@/lib/consent';

/** Cookie choice for visitors in the EEA, UK and Switzerland (see lib/consent.ts). */
export function ConsentBanner() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (inConsentRegion() && getConsent() === null) setOpen(true);
  }, []);

  if (!open) return null;

  const choose = (choice: 'granted' | 'denied') => {
    setConsent(choice);
    setOpen(false);
  };

  return (
    <div
      role="region"
      aria-label="Cookie choice"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur px-4 py-3"
      style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-sm text-zinc-300">
          We use cookies for website analytics and to measure our ads. Sign-in cookies are always on.{' '}
          <Link href="/privacy" className="text-blue-300 hover:text-blue-200 underline">
            Privacy policy
          </Link>
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => choose('denied')}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => choose('granted')}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
