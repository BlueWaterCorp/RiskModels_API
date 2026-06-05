'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { DOCS_NAV, type DocsNavItem } from '@/lib/docs-nav';

function itemClasses(active: boolean): string {
  return [
    'block rounded-md px-3 py-1.5 text-sm transition-colors',
    active
      ? 'bg-zinc-800/90 text-white font-medium ring-1 ring-zinc-700/70'
      : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-100',
  ].join(' ');
}

function NavList({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  const renderItem = (item: DocsNavItem) => {
    const active = !item.external && pathname === item.href;
    if (item.external) {
      return (
        <a
          key={item.href}
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          className={itemClasses(false)}
          onClick={onNavigate}
        >
          {item.label} <span aria-hidden className="text-zinc-600">↗</span>
        </a>
      );
    }
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={itemClasses(active)}
        onClick={onNavigate}
      >
        {item.label}
      </Link>
    );
  };

  return (
    <nav className="space-y-6">
      {DOCS_NAV.map((group) => (
        <div key={group.title}>
          <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            {group.title}
          </p>
          <div className="space-y-0.5">{group.items.map(renderItem)}</div>
        </div>
      ))}
    </nav>
  );
}

export default function DocsSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile: disclosure toggle so all pages stay reachable on phones */}
      <div className="lg:hidden mb-6">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-sm font-semibold text-zinc-200"
        >
          {open ? <X size={16} aria-hidden /> : <Menu size={16} aria-hidden />}
          Docs menu
        </button>
        {open && (
          <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <NavList pathname={pathname} onNavigate={() => setOpen(false)} />
          </div>
        )}
      </div>

      {/* Desktop: persistent rail */}
      <aside className="hidden lg:block w-60 shrink-0">
        <div className="sticky top-40 max-h-[calc(100vh-11rem)] overflow-y-auto pr-2 pb-10">
          <NavList pathname={pathname} />
        </div>
      </aside>
    </>
  );
}
