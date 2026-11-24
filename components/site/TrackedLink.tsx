'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { gtmAnalytics } from '@/lib/posthog-client';

/** A link that records a `cta_clicked` event before navigating. */
export function TrackedLink({
  href,
  label,
  location,
  className,
  children,
}: {
  href: string;
  /** Event label; defaults to the link text when that is a string. */
  label?: string;
  location: string;
  className?: string;
  children: ReactNode;
}) {
  const name = label ?? (typeof children === 'string' ? children : href);
  return (
    <Link href={href} className={className} onClick={() => gtmAnalytics.ctaClicked(name, location)}>
      {children}
    </Link>
  );
}
