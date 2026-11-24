'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { ChatBubble } from '@/components/chat/ChatBubble';
import { PostHogProvider } from '@/components/posthog-provider';
import { ConsentBanner } from '@/components/ConsentBanner';
import { UTMTracker } from '@/components/UTMTracker';
import { ThemeProvider } from '@/components/ThemeProvider';

export const PRINT_PATH_PREFIX = '/render-snapshot';

const PRINT_CSS = `
  @page { size: A4; margin: 0; }
  html, body { margin: 0; padding: 0; background: white; color: #111827; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
`;

/**
 * Site frame around every page. The path is read in the browser and during
 * render from the router, so the root layout reads no request headers and
 * public pages can be served from the cache. Print templates under
 * /render-snapshot get the bare page with A4 print rules.
 */
export function SiteChrome({ children, footer }: { children: ReactNode; footer: ReactNode }) {
  const pathname = usePathname() ?? '';

  if (pathname.startsWith(PRINT_PATH_PREFIX)) {
    return (
      <>
        <style>{PRINT_CSS}</style>
        {children}
      </>
    );
  }

  return (
    <PostHogProvider>
      <ThemeProvider>
        <div className="flex flex-col min-h-screen">
          <Navbar />
          <main className="flex-1 min-h-0 pt-16 sm:pt-[4.5rem]">{children}</main>
          {footer}
        </div>
        <ChatBubble />
        <UTMTracker />
        <ConsentBanner />
      </ThemeProvider>
    </PostHogProvider>
  );
}
