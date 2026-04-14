'use client';

import Link from 'next/link';
import Logo from './Logo';
import PortalSearch from './PortalSearch';
import { LogOut, Menu, X } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';

function navActive(pathname: string, href: string): boolean {
  if (href === '/docs/api') return pathname.startsWith('/docs');
  if (href === '/account/usage') return pathname.startsWith('/account');
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      setUser(u);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    setMobileMenuOpen(false);
    router.refresh();
  }, [router]);

  const navLinks = [
    { href: '/docs/api', label: 'Docs' },
    { href: '/api-reference', label: 'Reference' },
    { href: '/quickstart', label: 'Quickstart' },
    { href: '/pricing', label: 'Pricing' },
    { href: '/account/usage', label: 'Usage' },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-zinc-800/80 bg-zinc-950/85 shadow-sm shadow-black/20 backdrop-blur-md supports-[backdrop-filter]:bg-zinc-950/75">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3 lg:gap-4 h-16 min-w-0">
          <div className="flex-shrink-0">
            <Logo />
          </div>

          <div className="hidden md:block flex-1 min-w-0 max-w-md lg:max-w-lg xl:max-w-xl">
            <PortalSearch />
          </div>

          <div className="hidden md:flex items-center gap-1 lg:gap-2 flex-shrink-0">
            {navLinks.map((link) => {
              const active = navActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={[
                    'rounded-lg px-2.5 py-2 text-sm font-semibold transition-colors',
                    active
                      ? 'bg-zinc-800/90 text-white ring-1 ring-zinc-700/80'
                      : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-100',
                  ].join(' ')}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>

          <div className="hidden md:flex items-center gap-2 lg:gap-3 flex-shrink-0 ml-auto">
            {user ? (
              <>
                <span
                  className="hidden xl:inline text-xs text-zinc-500 max-w-[200px] truncate"
                  title={user.email ?? undefined}
                >
                  {user.email}
                </span>
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-200 transition-colors px-1"
                >
                  <LogOut size={14} className="opacity-80" aria-hidden />
                  Sign out
                </button>
              </>
            ) : (
              <Link
                href="/get-key"
                className="text-sm font-medium text-zinc-500 hover:text-zinc-200 transition-colors px-1"
              >
                Sign in
              </Link>
            )}
            <Link
              href="/get-key"
              className="px-3.5 py-2 text-sm font-semibold rounded-lg bg-gradient-to-b from-blue-500 to-blue-600 text-white shadow-md shadow-blue-950/30 ring-1 ring-white/10 hover:from-blue-400 hover:to-blue-500 transition-all"
            >
              {user ? 'API keys' : 'Get API Key'}
            </Link>
          </div>

          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 text-zinc-300 hover:text-zinc-100 ml-auto"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="md:hidden bg-zinc-900/95 border-t border-zinc-800 backdrop-blur-md">
          <div className="px-4 py-3 space-y-4 max-h-[min(85vh,32rem)] overflow-y-auto">
            <PortalSearch />
            <div className="space-y-1 pt-1">
              {navLinks.map((link) => {
                const active = navActive(pathname, link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={[
                      'block rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors',
                      active ? 'bg-zinc-800 text-white' : 'text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100',
                    ].join(' ')}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>
            <div className="pt-3 border-t border-zinc-800 space-y-2">
              {user ? (
                <>
                  {user.email && (
                    <p className="text-center text-xs text-zinc-500 px-2 truncate" title={user.email}>
                      {user.email}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleSignOut()}
                    className="w-full flex items-center justify-center gap-2 text-sm font-medium text-zinc-400 hover:text-zinc-200 py-2"
                  >
                    <LogOut size={16} aria-hidden />
                    Sign out
                  </button>
                </>
              ) : (
                <Link
                  href="/get-key"
                  className="block text-center text-sm font-medium text-zinc-400 hover:text-zinc-200 py-2"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Sign in
                </Link>
              )}
              <Link
                href="/get-key"
                className="block px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-b from-blue-500 to-blue-600 rounded-lg text-center transition-all shadow-md shadow-blue-950/25"
                onClick={() => setMobileMenuOpen(false)}
              >
                {user ? 'API keys' : 'Get API Key'}
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
