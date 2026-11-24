'use client';

import Link from 'next/link';
import Logo from './Logo';
import PortalSearch from './PortalSearch';
import { ThemeToggle } from './ThemeToggle';
import { LogOut, Menu, X } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';

function navActive(pathname: string, href: string): boolean {
  if (href === '/docs') return pathname === '/docs' || pathname.startsWith('/docs/');
  if (href === '/api-reference') return pathname.startsWith('/api-reference');
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

  const navLinks: { href: string; label: string; external?: boolean }[] = [
    { href: '/installation', label: 'Quickstart' },
    { href: '/api-reference', label: 'API reference' },
    { href: '/docs', label: 'Docs' },
    { href: '/for-agents', label: 'Agents' },
    { href: '/security-master-feed', label: 'Event feed' },
    { href: '/pricing', label: 'Pricing' },
    { href: '/status', label: 'Status' },
    {
      href: 'https://riskmodels.org/research?utm_source=riskmodels-app&utm_medium=primary-nav&utm_campaign=cross-site',
      label: 'Research',
      external: true,
    },
  ];

  const linkBase = 'rm-mono rounded-[2px] px-2.5 py-1.5 text-xs transition-colors';

  return (
    <nav className="fixed left-0 right-0 top-0 z-50 border-b border-rule bg-background/95 backdrop-blur-md">
      <div className="mx-auto max-w-screen-2xl px-4 sm:px-6">
        <div className="flex h-16 min-w-0 items-center gap-3 sm:h-[4.5rem] lg:gap-5">
          <Logo subWord="API" />

          <div className="hidden min-w-0 flex-1 items-center justify-center gap-0.5 lg:flex">
            {navLinks.map((link) => {
              const active = !link.external && navActive(pathname, link.href);
              const className = `${linkBase} ${
                active ? 'bg-secondary text-ink' : 'text-ink-muted hover:bg-secondary/60 hover:text-ink'
              }`;
              if (link.external) {
                return (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={className}
                  >
                    {link.label}
                    <span aria-hidden className="ml-0.5 text-[11px] opacity-70">
                      ↗
                    </span>
                  </a>
                );
              }
              return (
                <Link key={link.href} href={link.href} className={className}>
                  {link.label}
                </Link>
              );
            })}
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2 lg:ml-0">
            <div className="hidden w-56 2xl:block">
              <PortalSearch />
            </div>
            {user ? (
              <>
                <span
                  className="hidden max-w-[180px] truncate text-xs text-ink-muted 2xl:inline"
                  title={user.email ?? undefined}
                >
                  {user.email}
                </span>
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  className="rm-mono hidden items-center gap-1.5 px-1 text-xs text-ink-muted hover:text-ink lg:inline-flex"
                >
                  <LogOut size={13} aria-hidden />
                  Sign out
                </button>
              </>
            ) : (
              <Link
                href="/get-key"
                className="rm-mono hidden px-1 text-xs text-ink-muted underline-offset-4 hover:text-ink hover:underline lg:inline-flex"
              >
                Sign in
              </Link>
            )}
            <Link
              href="/get-key"
              className="rm-mono inline-flex h-8 items-center rounded-[2px] border border-navy px-3 max-[350px]:hidden text-xs text-navy transition-colors hover:bg-navy hover:text-[var(--rm-on-navy)]"
            >
              {user ? 'API keys' : (
                <>
                  <span className="sm:hidden">API key</span>
                  <span className="hidden sm:inline">Get a free API key</span>
                </>
              )}
            </Link>
            <ThemeToggle className="hidden sm:inline-flex" />
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="inline-flex size-8 items-center justify-center rounded-[2px] border border-rule text-ink-muted hover:text-ink lg:hidden"
              aria-label="Toggle menu"
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <X size={16} /> : <Menu size={16} />}
            </button>
          </div>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="border-t border-rule bg-background lg:hidden">
          <div className="max-h-[min(85vh,34rem)] space-y-4 overflow-y-auto px-4 py-3">
            <PortalSearch />
            <div className="divide-y divide-[var(--rm-rule)] border-y border-rule">
              {navLinks.map((link) => {
                const active = !link.external && navActive(pathname, link.href);
                const className = `block px-1 py-2.5 text-sm ${active ? 'font-semibold text-ink' : 'text-ink-muted hover:text-ink'}`;
                if (link.external) {
                  return (
                    <a
                      key={link.href}
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={className}
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      {link.label} <span aria-hidden>↗</span>
                    </a>
                  );
                }
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={className}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-3">
              {user ? (
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink"
                  title={user.email ?? undefined}
                >
                  <LogOut size={15} aria-hidden />
                  Sign out
                </button>
              ) : (
                <Link
                  href="/get-key"
                  className="text-sm text-ink-muted hover:text-ink"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Sign in
                </Link>
              )}
              <span className="inline-flex items-center gap-2 text-xs text-ink-muted">
                Light / dark <ThemeToggle />
              </span>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
