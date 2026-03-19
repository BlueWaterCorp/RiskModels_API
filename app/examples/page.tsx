'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * /examples merged into /quickstart — keep old URL for bookmarks & external links.
 * Client redirect preserves the #code-examples hash (server redirects often omit it).
 */
export default function ExamplesRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/quickstart#code-examples');
  }, [router]);

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-400 text-sm">
      Redirecting to quickstart…
    </div>
  );
}
