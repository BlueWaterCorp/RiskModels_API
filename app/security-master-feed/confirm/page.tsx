// Confirmation page for the security master feed's double opt-in. The link in the
// confirmation email opens this page; the visitor confirms with a button, which
// POSTs to /api/feed-waitlist/confirm. Opening the page alone changes nothing, so
// mail scanners that fetch links cannot confirm anyone.

import type { Metadata } from "next";
import { Suspense } from "react";
import { FeedConfirm } from "./FeedConfirm";

export const metadata: Metadata = {
  title: "Confirm your email — Security Master Change Feed",
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-xl px-6 py-20 text-zinc-300">Loading…</main>}>
      <FeedConfirm />
    </Suspense>
  );
}
