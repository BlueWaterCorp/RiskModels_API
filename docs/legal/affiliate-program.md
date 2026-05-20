# RiskModels Affiliate Program — Terms

**Current version: v1.2** · Effective on the date you accept via the dashboard banner or email reply.

> **This document is the source of truth.** The page rendered at
> `riskmodels.net/terms/affiliate` mirrors this file. Bump the version
> string at the top, append a new section to the changelog, and ship —
> the active re-consent banner in `/affiliate` blocks every affiliate
> dashboard until they accept the new version.

---

## What this program is

Blue Water Macro Corp ("we", "RiskModels") runs an affiliate program that pays you a percentage of revenue we collect from API customers you refer. You ("Affiliate") get a unique referral code; people who use that code when picking up an API key are attributed to you, and we share commission on what they pay us.

This is a referral / revenue-share arrangement. It is not employment, partnership, or agency. You are an independent contractor for tax and legal purposes; you are responsible for your own taxes on any commission paid.

## How attribution works

1. We give you a referral code (e.g. `RM-ABC123`) and a share link of the form `https://riskmodels.app/get-key?ref=YOUR_CODE`.
2. When someone clicks the link, we log the visit (referral code, timestamp, hashed IP, hashed user-agent, source URL, UTM parameters). This is a **leading indicator** — it tells you the link is working before any signup happens. We do not store raw IPs or unhashed user-agent strings.
3. If that visitor creates an API key in the same browser session, the key is attributed to you. The attribution is permanent for that key for as long as it exists, regardless of whether you remain in the program.
4. As that key spends money on API usage, we calculate commission per the rate that was in effect for you **at the time the key was created** (see "Commission rate" below).

If you want to publish posts using our content tools (e.g. the post-builder Colab notebook we ship to affiliates), we additionally log:
- Which affiliate generated which chart
- Mode (single-stock or comparison) and tickers used
- Optional self-reported post URLs you submit via your dashboard

These are tied to your account and used only for our internal reporting and your own dashboard.

## Commission rate

**The commission rate effective for you at the moment a referred key is created is the rate that key earns for its lifetime.** This is the most important sentence in this document and we want to be unambiguous about it.

- Default rate is published on your dashboard.
- We may negotiate a different rate with individual affiliates.
- We may change rates with at least **14 days' written notice** (email + dashboard banner).
  - The new rate applies only to **keys created after the change effective date**.
  - All keys created before the change continue to earn at their original locked rate.
  - We will not retroactively re-price historical referrals.

This rule protects you from rate cuts and protects us from runaway costs if we raise the headline rate later. It also means a key created at 30% will keep paying you 30% of its revenue forever, even if we drop the public rate to 10% for new affiliates next year.

## Payouts

- We compute commission earned on a rolling basis from billed revenue (not from estimated or quoted revenue).
- Payouts are processed manually for now. When your balance reaches a meaningful threshold (typically $100+), we send to the payout email on file.
- You can update your payout email or method by replying to `service@riskmodels.app`.
- Standard payment methods: ACH (US), Wise (international), or USDC. Check or wire by arrangement.
- We do not pay commission on chargebacks, refunds, or fraud. If a referred customer chargebacks an invoice, the corresponding commission is reversed from your balance.

## Status lifecycle

Your account moves through these states. We will give you notice before any change to a less-favorable status.

| Status | What it means |
|---|---|
| **`active`** | Normal. New referrals attribute, existing referrals pay commission. |
| **`dormant`** | No referral-link clicks, post-builder activity, or new signups in the last 60 days. We send you a "still interested?" email. New referrals still attribute, existing referrals still pay. |
| **`paused`** | After 30 additional days dormant with no response, or by request, or if you violate these terms. **No new referrals attribute**, but existing referrals continue paying commission. You can request reactivation at any time. |
| **`terminated`** | Final state. **No new referrals attribute and no future commissions on existing referrals.** We pay out any remaining balance within 30 days of termination. |

We may move you to `paused` or `terminated` for: violation of the posting standards (below), repeated terms violations, fraud, or material breach. We will tell you why in writing.

You may move yourself to `paused` or `terminated` at any time by emailing `service@riskmodels.app`.

## Posting standards

When you post or share content using the program, you must:

1. **Disclose the affiliate relationship.** A one-line disclosure ("I get a referral credit if you sign up") in the post or as a comment. This is FTC-required in the US and standard practice elsewhere.
2. **Don't misrepresent the product.** Don't claim performance, accuracy, or features that aren't real. Cite the chart you generated; don't invent numbers.
3. **Don't spam.** Respect each platform's rules (subreddit posting cadence, LinkedIn group rules, etc.). Repeated platform bans are grounds for `paused` status.
4. **No paid traffic / SEO clickfarms.** Commission must come from organic content. Bot traffic, incentivized clicks, paid review farms, and similar tactics will result in `terminated` status and forfeiture of pending commission.
5. **No impersonation.** Don't claim to work for RiskModels or imply endorsement beyond the affiliate relationship.

## Display handle for chart watermarks

If you use our chart-generation tools (the post-builder notebook, SDK snapshots, etc.), the chart includes a small attribution string of the form `via @{your_display_handle} on riskmodels.app`. This is what credits you publicly when someone screenshots and shares your work.

- We set your `display_handle` from the local-part of your account email by default. You can request a different handle at any time.
- Handles must be 2–30 characters, lowercase alphanumerics + dot/underscore/hyphen.
- We reserve the right to reject handles that impersonate other people, contain offensive content, or are misleading (e.g. "official", "rm_admin").
- Suppressing the watermark requires our written approval — typically reserved for institutional partners under separate agreement.

## Program changes and wind-down

We may change these terms at any time. Material changes (anything affecting the math of how you get paid, what we track, or your status lifecycle) trigger the active re-consent banner on your dashboard. You cannot use the dashboard until you accept the new version.

If you decline the new terms, your status moves to `declined_terms_v{N}`. Existing referrals continue earning at their **previously-locked rate** under the previously-accepted terms; no new attributions are accepted. We pay out your final balance within 30 days.

We may also wind down the program entirely. Two paths, our choice depending on circumstances:

1. **Sunset.** New attributions stop on a public effective date. Existing referrals continue earning commission at their locked rates for **6 months** after the effective date (the "tail period"). At the end of the tail, we pay all remaining balances and the program closes.
2. **Termination.** New attributions stop on a public effective date. **No further commissions accrue from that date**, including on existing referrals. We pay all balances owed within 30 days.

We will give at least **30 days' notice** before either action. We will default to Sunset unless circumstances make Termination necessary (regulatory, fraud, business closure, etc.).

## Privacy

Tracking we do that touches third parties:
- **Referral-link clicks**: visitor's IP and user-agent are SHA-256-HMAC hashed with a server-side salt before storage. Raw values are not retained. Used for click counts and unique-visitor estimates.
- **Post-builder API usage**: standard API request logging (account, capability, latency, cost) plus metadata describing the post-builder action (mode, tickers).
- **Self-reported post URLs**: if you paste a Reddit/Twitter/LinkedIn URL into your dashboard, we store it. We do not crawl or fetch the page beyond the host name (used to auto-classify the channel).

This program-specific tracking is in addition to whatever's in our general privacy policy at `riskmodels.app/privacy`. If those conflict, the privacy policy controls for non-affiliate users; this section controls for affiliate-related data.

## Disclaimers and liability

- **No exclusivity.** You can promote competing products. We can sign other affiliates targeting the same audience.
- **No guarantee of revenue.** We don't promise any specific commission outcome. Most affiliates take 4–8 weeks to see meaningful revenue.
- **No employment relationship.** Nothing here makes you our employee, partner, or agent. You can't bind us to anything; we can't bind you.
- **Liability cap.** Our total liability under this program is capped at the greater of (a) commission paid to you in the 12 months before the claim, or (b) $500. We are not liable for indirect, consequential, or special damages.
- **Governing law.** These terms are governed by the laws of the State of California, USA. Disputes resolved in San Francisco.

## How to contact us

`service@riskmodels.app` for anything: payout method changes, status changes, terms questions, content reviews, complaints about other affiliates' behavior. We aim to reply within 2 business days.

---

## Changelog

### v1.2 — *current*

Material changes from v1.1:

1. **Commission-rate locking made explicit.** The rate effective at the time a referred key is created is the rate that key earns for life. Previously this was implied by code behavior; now it is stated in the contract. (See "Commission rate".)
2. **Status lifecycle defined.** Introduces `dormant` (60d inactivity flag) and clarifies `paused` vs `terminated` semantics. (See "Status lifecycle".)
3. **Wind-down terms.** Defines the Sunset (6-month tail) vs Termination (30-day final settlement) paths and our 30-day notice obligation. (See "Program changes and wind-down".)
4. **Click-tracking disclosure.** Discloses HMAC hashing of visitor IP/UA on referral-link clicks and the leading-indicator funnel in your dashboard. (See "How attribution works" and "Privacy".)

These are clarifications — they describe behavior we've designed into the platform. None of them retroactively change anything about referrals attributed before v1.2's effective date.

### v1.1 — superseded

- Active re-consent banner introduced
- Display-handle column for chart-watermark attribution
- Earlier baseline. *(Pre-v1.1 history not preserved in source control; v1.1 was the first version with a documented version string.)*
