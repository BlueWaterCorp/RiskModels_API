import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
export function authorized(request: NextRequest) {
  const expected = process.env.CRON_SECRET?.trim();
  const actual = request.headers.get('authorization');
  if (!expected || !actual) return false;
  const a = Buffer.from(actual), b = Buffer.from(`Bearer ${expected}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
