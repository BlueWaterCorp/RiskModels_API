'use client';

import { useEffect } from 'react';

/**
 * Applies dark class to html on all pages for consistent API-reference-style dark theme.
 */
export default function ThemeByPath({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  return <>{children}</>;
}
