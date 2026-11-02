// Unsubscribe page for security master feed emails. The link in each email
// opens this page; the visitor confirms with a button, which POSTs to
// /api/feed-waitlist/unsubscribe. Opening the page alone changes nothing, so
// link scanners cannot unsubscribe anyone.

import type { Metadata } from "next";
import { Suspense } from "react";
import { FeedUnsubscribe } from "./FeedUnsubscribe";

export const metadata: Metadata = {
  title: "Unsubscribe — Security Master Change Feed",
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-xl px-6 py-20 text-zinc-300">Loading…</main>}>
      <FeedUnsubscribe />
    </Suspense>
  );
}
