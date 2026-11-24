import { eventLedgerRss } from "@/lib/event-ledger-rss";
import { FEED_PAGE_URL } from "@/lib/feed-descriptor";
import { servePrivateFeed } from "@/lib/feed-private-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Subscriber RSS: the current Event Ledger export, for an approved subscriber's credential only. */
export async function GET(req: Request) {
  return servePrivateFeed(req, (file) => ({
    contentType: "application/rss+xml; charset=utf-8",
    body: eventLedgerRss(file, {
      title: "RiskModels Event Ledger (subscriber feed)",
      description:
        "Current verified security events for approved subscribers, with SEC sources, known and event dates, corrections and withdrawals. End-of-day and historical; a rolling window, not full history. This feed address is personal to the subscriber.",
      link: FEED_PAGE_URL,
      itemFallbackLink: FEED_PAGE_URL,
    }),
  }));
}
