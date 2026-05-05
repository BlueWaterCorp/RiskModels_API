import { NextResponse } from 'next/server';
import { getAppUrl } from '@/lib/app-url';

/**
 * Alias URL for crawlers that look under /.well-known/ — same body as /llms.txt.
 */
export async function GET() {
  const base = getAppUrl();
  const url = new URL('/llms.txt', `${base}/`);
  return NextResponse.redirect(url.toString(), 307);
}
