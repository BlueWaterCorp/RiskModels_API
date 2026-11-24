import { servePrivateFeed } from "@/lib/feed-private-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Subscriber JSON: the current Event Ledger export, for an approved subscriber's credential only. */
export async function GET(req: Request) {
  return servePrivateFeed(req, (file) => ({
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(file),
  }));
}
