/**
 * Machine-readable description of the security master change feed.
 *
 * One source of truth for three uses:
 *   - embedded in every feed email (the "For agents and automation" block), so a
 *     recipient can save the message to a folder and an agent can later read it
 *     and judge whether the feed helps a process the recipient runs;
 *   - served at /security-master-feed/descriptor.json, the always-current copy;
 *   - rendered in the plain-text part of each email.
 *
 * Statements here are limited to what the landing page and ERM3-67 already say.
 * No coverage, latency or quality figure appears until it has been measured and
 * published. Identifier schemes beyond FIGI, CIK, the RiskModels id and ticker,
 * and data-vendor names, never appear.
 */

import { CANONICAL_SITE_URL } from "./constants";

export const FEED_PAGE_URL = `${CANONICAL_SITE_URL}/security-master-feed`;
export const FEED_DESCRIPTOR_URL = `${FEED_PAGE_URL}/descriptor.json`;
export const FEED_CONTACT_EMAIL = "service@riskmodels.app";

export interface FeedDescriptorOptions {
  /** "early_access" until the first edition is published, then "published". */
  status?: "early_access" | "published";
  /** ISO date of the first published edition; null while in early access. */
  firstEdition?: string | null;
}

export function buildFeedDescriptor(opts: FeedDescriptorOptions = {}) {
  const status = opts.status ?? "early_access";
  return {
    schema: "riskmodels.feed-descriptor/1",
    name: "RiskModels security master change feed",
    publisher: "RiskModels, a DBA of Blue Water Macro Corp.",
    status,
    first_edition: opts.firstEdition ?? null,
    summary:
      "A daily, SEC-filing-cited feed of US equity identity and status events, with corrections to earlier editions and the date each fact became known.",
    scope: {
      market: "US equities",
      event_types: [
        "ticker_change",
        "name_change",
        "listing_status",
        "merger_or_reorganisation",
        "split",
      ],
      each_event_carries: ["effective_date", "known_as_of_date", "filing_citation"],
      keys: ["figi", "cik", "riskmodels_id", "ticker"],
      out_of_scope: [
        "dividends, tender offers and holder elections",
        "price and model-value corrections",
        "non-US listings",
      ],
    },
    edition_contents: [
      "events learned that day",
      "corrections to earlier editions: old value, new value, first edition, reason",
    ],
    complements:
      "Commercial risk platforms, data terminals and in-house security master processes. The feed is an independent record to reconcile against, not a replacement.",
    relevant_if: [
      "a process maintains or reconciles a US equity security master",
      "a backtest or research pipeline needs the securities that existed on a past date",
      "a position, holding or ticker must be traced across a rename, merger, split or delisting",
      "an identifier mismatch needs a filing to settle it",
    ],
    not_relevant_if: [
      "the need is prices, fundamentals, forecasts or investment advice",
      "the need is non-US securities",
      "the need is dividend or tender-offer events",
    ],
    how_to_evaluate: [
      "When the sample week is published, compare its events with your master's changes for the same dates.",
      "Pick three events and read the cited filings.",
      "Note any event your master lacks, or has on a different date.",
      "Reply to the sender with what you find.",
    ],
    cost: "free to early clients for about the first year",
    delivery_formats_under_consideration: ["email digest", "api", "webhook"],
    caveats: [
      status === "early_access"
        ? "Early access: no edition has been published yet."
        : "Published editions are historical, end-of-day identity facts.",
      "No coverage, latency or quality figures are published yet.",
      "Not investment advice.",
    ],
    links: { about: FEED_PAGE_URL, descriptor: FEED_DESCRIPTOR_URL },
    contact: FEED_CONTACT_EMAIL,
  };
}

export type FeedDescriptor = ReturnType<typeof buildFeedDescriptor>;

export function feedDescriptorJson(opts?: FeedDescriptorOptions): string {
  return JSON.stringify(buildFeedDescriptor(opts), null, 2);
}
