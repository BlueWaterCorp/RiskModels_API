import { NextResponse } from 'next/server';

/**
 * Receives browser reports for the Content-Security-Policy-Report-Only header
 * (next.config.mjs). One log line per report; nothing is stored.
 */
export async function POST(request: Request) {
  try {
    const text = (await request.text()).slice(0, 4000);
    const body = JSON.parse(text) as Record<string, unknown>;
    const r = (body['csp-report'] ?? body) as Record<string, unknown>;
    const pick = (k: string) => String(r[k] ?? '').slice(0, 200);
    console.warn(
      `[csp-report] directive=${pick('effective-directive') || pick('violated-directive')} blocked=${pick('blocked-uri')} page=${pick('document-uri')}`,
    );
  } catch {
    // Malformed or oversized report: ignore.
  }
  return new NextResponse(null, { status: 204 });
}
