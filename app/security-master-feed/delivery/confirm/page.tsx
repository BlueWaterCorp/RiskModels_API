// Confirms a team-inbox request. The link in emails/feed-delivery-change.tsx opens
// this page; the contact confirms with a button (POST /api/feed-waitlist/delivery/confirm).
// Opening the page alone changes nothing, so mail scanners cannot confirm anything.

import type { Metadata } from "next";
import { Suspense } from "react";
import { FeedDeliveryConfirm } from "./FeedDeliveryConfirm";

export const metadata: Metadata = {
  title: "Confirm the team inbox — Event Ledger",
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-xl px-6 py-20 text-zinc-300">Loading…</main>}>
      <FeedDeliveryConfirm />
    </Suspense>
  );
}
