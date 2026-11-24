/**
 * Shared gate for the private Event Ledger routes
 * (/security-master-feed/private/feed.xml and /latest.json).
 *
 * The export is read only after the credential is accepted. A missing, malformed,
 * unknown, revoked or no-longer-eligible credential all get the same 401, so the
 * reply does not say which. Nothing here logs the request URL or the credential.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, rateLimit } from "@/lib/oauth/rate-limit";
import { cachedLedgerExports } from "@/lib/event-ledger-public-live";
import type { PublicLatestFile } from "@/lib/event-ledger-public";
import { PRIVATE_FEED_HEADERS, checkFeedKey, readFeedKey } from "@/lib/feed-access";
import { FEED_PAGE_URL } from "@/lib/feed-descriptor";

const RATE_LIMIT = 300;
const RATE_WINDOW_SEC = 3600;

const refuse = (status: number, error: string, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error, access: `${FEED_PAGE_URL}/access` }), {
    status,
    headers: { ...PRIVATE_FEED_HEADERS, "Content-Type": "application/json; charset=utf-8", ...extra },
  });

export async function servePrivateFeed(
  req: Request,
  render: (file: PublicLatestFile) => { body: string; contentType: string },
): Promise<Response> {
  const rl = await rateLimit("feed-private", clientIp(req), RATE_LIMIT, RATE_WINDOW_SEC);
  if (!rl.ok) return refuse(429, "Too many requests", { "Retry-After": String(rl.retryAfter) });

  let verdict: Awaited<ReturnType<typeof checkFeedKey>>;
  try {
    verdict = await checkFeedKey(createAdminClient(), readFeedKey(req));
  } catch {
    verdict = "unavailable";
  }
  if (verdict === "unavailable") return refuse(503, "Event Ledger temporarily unavailable", { "Retry-After": "60" });
  if (verdict !== "ok") {
    return refuse(401, "A subscriber feed credential is required", { "WWW-Authenticate": 'Bearer realm="event-ledger"' });
  }

  try {
    const out = render((await cachedLedgerExports()).subscriber);
    return new Response(out.body, { headers: { ...PRIVATE_FEED_HEADERS, "Content-Type": out.contentType } });
  } catch {
    return refuse(503, "Event Ledger temporarily unavailable", { "Retry-After": "60" });
  }
}
