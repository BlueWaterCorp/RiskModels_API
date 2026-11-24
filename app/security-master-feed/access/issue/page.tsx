// Opened from the access email. The visitor creates the private feed address with a
// button, which POSTs to /api/feed-waitlist/access/issue. Opening the page alone
// changes nothing, so a mail scanner that fetches the link cannot use it up.

import type { Metadata } from "next";
import { Suspense } from "react";
import { FeedAccessIssue } from "./FeedAccessIssue";

export const metadata: Metadata = {
  title: "Create your feed address — Security Master Change Feed",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function Page() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-xl px-6 py-20 text-zinc-300">Loading…</main>}>
      <FeedAccessIssue />
    </Suspense>
  );
}
