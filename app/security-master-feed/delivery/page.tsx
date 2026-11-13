// "Send this to your team inbox instead": the edition footer links here with the
// recipient's token. The form only REQUESTS the change: the contact's own address
// gets an email to confirm it, so a forwarded copy cannot re-route anyone.

import type { Metadata } from "next";
import { Suspense } from "react";
import { FeedDelivery } from "./FeedDelivery";

export const metadata: Metadata = {
  title: "Send the Event Ledger to a team inbox",
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-xl px-6 py-20 text-zinc-300">Loading…</main>}>
      <FeedDelivery />
    </Suspense>
  );
}
