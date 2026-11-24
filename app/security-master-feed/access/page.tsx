// Approved subscribers ask here for a private feed address. The form only sends an
// email to the address typed, and only if that address is an approved subscriber;
// the page never says whether it is.

import type { Metadata } from "next";
import { FeedAccessRequest } from "./FeedAccessRequest";

export const metadata: Metadata = {
  title: "Private feed address — Security Master Change Feed",
  description: "Approved subscribers create a private RSS address for the RiskModels Event Ledger.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <FeedAccessRequest />;
}
