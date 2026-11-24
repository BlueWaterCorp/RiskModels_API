'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

/**
 * Light is the default surface. Dark stays available from the toggle. The
 * system preference is not consulted, so the default is the same for every
 * first visit; a stored choice wins after that.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
      storageKey="rm-app-theme"
    >
      {children}
    </NextThemesProvider>
  );
}
