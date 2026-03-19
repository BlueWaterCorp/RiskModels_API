/**
 * Resolves the app base URL for redirects and links.
 * - NEXT_PUBLIC_APP_URL: production (set in Vercel)
 * - VERCEL_URL: preview deployments (auto-set by Vercel)
 * - localhost: local dev
 */
export function getAppUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return 'http://localhost:3000';
}
