'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

const BOX =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-[2px] border border-rule text-ink-muted transition-colors hover:text-ink';

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Render a stable placeholder until hydration so server and client markup agree.
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <span className={`${BOX} pointer-events-none opacity-0 ${className}`} aria-hidden />;
  }

  const isDark = resolvedTheme === 'dark';
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className={`${BOX} ${className}`}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Light mode' : 'Dark mode'}
    >
      {isDark ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
    </button>
  );
}
