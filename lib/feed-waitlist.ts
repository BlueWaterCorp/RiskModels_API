/**
 * Shared constants for the security master feed early-access list
 * (app/security-master-feed, app/api/feed-waitlist). Values match the
 * intended_use check constraint on public.feed_waitlist.
 */

export const FEED_INTENDED_USES = [
  { value: "risk_portfolio", label: "Risk / portfolio" },
  { value: "data_ops", label: "Data / operations" },
  { value: "research", label: "Research" },
  { value: "other", label: "Other" },
] as const;

export type FeedIntendedUse = (typeof FEED_INTENDED_USES)[number]["value"];

export const FEED_INTENDED_USE_VALUES: readonly string[] = FEED_INTENDED_USES.map((u) => u.value);
