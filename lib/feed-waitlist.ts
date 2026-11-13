/**
 * Shared constants for the feed list (app/security-master-feed, app/api/feed-waitlist).
 * Values match the check constraints on public.feed_waitlist (migrations
 * 20261102120000_feed_waitlist.sql and 20261113120000_feed_waitlist_profile_referrals_delivery.sql).
 */

export const FEED_INTENDED_USES = [
  { value: "risk_portfolio", label: "Risk / portfolio" },
  { value: "data_ops", label: "Data / operations" },
  { value: "research", label: "Research" },
  { value: "other", label: "Other" },
] as const;

export type FeedIntendedUse = (typeof FEED_INTENDED_USES)[number]["value"];

export const FEED_INTENDED_USE_VALUES: readonly string[] = FEED_INTENDED_USES.map((u) => u.value);

export const FEED_FIRM_TYPES = [
  { value: "asset_manager", label: "Asset manager" },
  { value: "hedge_fund", label: "Hedge fund" },
  { value: "allocator", label: "Allocator (pension, endowment, fund of funds)" },
  { value: "bank", label: "Bank or broker" },
  { value: "data_vendor", label: "Data or technology provider" },
  { value: "academic", label: "Academic" },
  { value: "other", label: "Other" },
] as const;

export const FEED_FIRM_SIZES = [
  { value: "under_100m", label: "Under $100M AUM" },
  { value: "100m_1b", label: "$100M to $1B" },
  { value: "1b_10b", label: "$1B to $10B" },
  { value: "10b_100b", label: "$10B to $100B" },
  { value: "over_100b", label: "Over $100B" },
  { value: "not_applicable", label: "Not applicable" },
] as const;

/** Multi-select on the form; stored in feed_waitlist.uses. */
export const FEED_USES = [
  { value: "reconciliation", label: "Check our own security master" },
  { value: "corporate_actions", label: "Track delistings and corporate actions" },
  { value: "risk_portfolio", label: "Risk or portfolio monitoring" },
  { value: "research_backtesting", label: "Research or backtesting" },
  { value: "compliance", label: "Compliance or restricted lists" },
  { value: "data_ops", label: "Data operations" },
  { value: "other", label: "Other" },
] as const;

export const FEED_AUDIENCES = [
  { value: "me", label: "Me" },
  { value: "team", label: "My team" },
  { value: "automated", label: "An automated system" },
] as const;

export const FEED_FIRM_TYPE_VALUES: readonly string[] = FEED_FIRM_TYPES.map((v) => v.value);
export const FEED_FIRM_SIZE_VALUES: readonly string[] = FEED_FIRM_SIZES.map((v) => v.value);
export const FEED_USE_VALUES: readonly string[] = FEED_USES.map((v) => v.value);
export const FEED_AUDIENCE_VALUES: readonly string[] = FEED_AUDIENCES.map((v) => v.value);

/** Version of /legal/feed-terms stored with each signup; bump with any material change to that page. */
export const FEED_TERMS_VERSION = "2026-11-13";

/** Referral codes as feed_waitlist.referral_code stores them. */
export const REFERRAL_CODE_RE = /^[a-z0-9]{8,32}$/;
