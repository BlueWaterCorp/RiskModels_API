# Event Ledger RSS

The public feed is `https://www.riskmodels.org/events/feed.xml`. The `/events`
page links to it and advertises it through RSS autodiscovery. The research feed
at `/feed.xml` keeps its existing scope.

## Source and publication

`GET /security-master-feed/latest.json` serves the existing
`riskmodels.event-ledger-latest/1` presentation export. It uses `loadPublicLatest`
and the daily digest's client publication gate and output scans. It reads
verified events, withdrawals and supersession records, so replaced originals
are removed. Only the resulting public projection leaves the server. The raw
ledger and database privileges remain private. This route has no query options,
uses a five-minute server cache, and returns 503 on read or publication failure.

RM_ORG uses this export for both the page and RSS, with caching. The page can
show its explicitly dated archive when the export is unavailable; RSS returns
503 instead of silently publishing the archive. The feed is a rolling window
of the latest 20 public events, rather than complete event history.

RSS items separate knowledge and event dates and retain each date's basis.
Their IDs combine the event ID and a hash of the displayed revision: refreshes
retain the same ID; a correction or withdrawal changes it. Items link to the
event's row on `/events` and include the filing link and free-edition terms.

## Daily emails

`emails/event-ledger-digest.tsx` and `renderDigestText` add the same RSS promotion
near the top of each edition. The attached JSON Lines file, recipients, consent,
delivery schedule, send guards and cursors are unchanged.

Deploy the public export first, then RM_ORG. Verify the live RSS and page, then
fast-forward the clean `RiskModels_API_main` checkout used by the Dagster daily
job so upcoming editions use the updated HTML and text. No one-time campaign or
manual list send is required.
