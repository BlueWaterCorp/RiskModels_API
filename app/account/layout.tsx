// Account pages are per-user: always rendered per request, never served from a shared cache.
export const dynamic = 'force-dynamic';

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return children;
}
