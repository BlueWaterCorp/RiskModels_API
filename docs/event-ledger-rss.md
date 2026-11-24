# Event Ledger RSS

The Event Ledger is free for approved investment, research, risk and data
professionals. There are two feeds.

| Feed | Address | Contents |
|------|---------|----------|
| Public sample | `https://www.riskmodels.org/events/feed.xml` | A few verified events known at least a week before the export date, with that date stated |
| Subscriber | `/security-master-feed/private/feed.xml?key=…` | The latest 20 verified events |

The research feed at `riskmodels.org/feed.xml` keeps its existing scope and is public.

## Source and publication

One ledger read (`loadLedgerExports`, five-minute server cache) builds both
files with the daily digest's client publication gate and output scans. It reads
verified events, withdrawals and supersession records, so replaced originals
are removed. Only the resulting projection leaves the server. The raw ledger
and database privileges remain private.

- `GET /security-master-feed/latest.json` serves the public sample: the same
  `riskmodels.event-ledger-latest/1` shape plus `sample`, `sample_through`,
  `sample_note` and `access`. No query options; 503 on read or publication
  failure. RM_ORG renders the page and the sample RSS from it.
- `GET /security-master-feed/private/latest.json` and
  `GET /security-master-feed/private/feed.xml` serve the subscriber file and
  need a private-feed credential.

RSS items separate knowledge and event dates and retain each date's basis.
Their IDs combine the event ID and a hash of the displayed revision: refreshes
retain the same ID; a correction or withdrawal changes it. The same ID rule
applies in both feeds. Subscriber items link to the cited filing and include
the free-edition terms.

## Subscriber access

A request (`POST /api/feed-waitlist`) gives name, firm or affiliation, role and
intended use, and the owner confirms the address by email. An operator then
approves or rejects it; that decision is recorded with who made it and when.
One rule decides eligibility for email editions, the private feed and linked
delivery inboxes: confirmed, not unsubscribed, approved.

An approved contact asks for a private address at `/security-master-feed/access`.
A single-use link, valid for one hour, goes to their own inbox; opening it and
pressing the button creates the credential and shows the address once.

- Only the SHA-256 of a credential is stored. It is separate from the
  unsubscribe token and from API keys.
- One credential is live per contact. Creating a new one retires the old one.
  Unsubscribing, rejection or revocation retires it.
- Send it as `Authorization: Bearer <key>` where the client allows. RSS readers
  take only a URL, so `?key=` is accepted. Responses are `private, no-store`
  with `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`; application
  logs never record the key. Platform request logs record URLs, which is why a
  credential can be replaced at any time.
- Missing, unknown, retired or ineligible credentials all get the same 401.

## Daily emails

`emails/event-ledger-digest.tsx` and `renderDigestText` link to
`/security-master-feed/access` near the top of each edition. An edition never
contains a private feed address. The attached JSON Lines file, recipients'
consent, delivery schedule, send guards and cursors are unchanged.

## Deploy order

Database migration first, then this app, then RM_ORG. The sample keeps the
export's schema string, so the RM_ORG page works before and after its own deploy.
