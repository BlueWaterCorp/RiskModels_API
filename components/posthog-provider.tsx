'use client';

import { useEffect, Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { trackGaPageView } from '@/lib/google-ads-conversion';
import { initPostHog, trackPageView, resetUser } from '@/lib/posthog-client';

/** Records a page view on each navigation. Renders nothing. */
function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    initPostHog();
  }, []);

  useEffect(() => {
    if (pathname) {
      trackPageView(pathname);
      trackGaPageView(pathname);
    }
  }, [pathname, searchParams]);

  return null;
}

/**
 * The tracker reads the query string, which needs a Suspense boundary. The
 * boundary wraps the tracker alone: a boundary above the page lets the response
 * start (status 200) before the page can answer notFound().
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <PageViewTracker />
      </Suspense>
      {children}
    </>
  );
}

export { resetUser };
