/**
 * RSS 2.0 for an Event Ledger export file.
 *
 * Item identity matches the public sample feed on riskmodels.org exactly: the
 * same title, description lines and GUID (`event:<event_id>:<revision>`, where
 * the revision is a hash of title, description and family). So a reader sees an
 * event once, and sees it again only when a correction or a withdrawal changes
 * what the item says. A refresh of the file alone re-announces nothing.
 */
import { createHash } from "node:crypto";
import type { PublicLatestEvent, PublicLatestFile } from "@/lib/event-ledger-public";

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export function eventRssTitle(event: PublicLatestEvent): string {
  const label = [event.ticker, event.company].filter(Boolean).join(" · ") || "Security";
  return `${event.status === "rejected" ? "Withdrawn: " : event.flag ? "Correction: " : ""}${label} — ${event.event}`;
}

export function eventRssDescription(event: PublicLatestEvent): string {
  return [
    event.detail,
    `Status: ${event.status}.`,
    event.flag,
    `Known date: ${event.known_date ?? "not recorded"} (${event.known_basis ?? "basis not recorded"}).`,
    `Event date: ${event.effective_date ?? "not recorded"} (${event.effective_basis ?? "basis not recorded"}).`,
    event.source_url ? `SEC filing: ${event.source_url}` : null,
    event.license_label,
  ].filter(Boolean).join("\n");
}

export function eventRssGuid(event: PublicLatestEvent): string {
  const revision = createHash("sha256")
    .update(JSON.stringify([eventRssTitle(event), eventRssDescription(event), event.family]))
    .digest("hex")
    .slice(0, 16);
  return `event:${event.event_id}:${revision}`;
}

export interface EventRssChannel {
  title: string;
  description: string;
  /** The channel's page. */
  link: string;
  /** Used when an event has no filing URL. Never carries a credential. */
  itemFallbackLink: string;
  /** Self link. Omitted for a private feed, whose own URL carries the credential. */
  self?: string;
}

export function eventLedgerRss(file: PublicLatestFile, channel: EventRssChannel): string {
  const items = file.events.map((event) => {
    const date = event.known_date ? new Date(`${event.known_date}T00:00:00Z`) : null;
    const pubDate = date && !Number.isNaN(date.getTime()) ? `<pubDate>${date.toUTCString()}</pubDate>` : "";
    return (
      `<item><title>${escapeXml(eventRssTitle(event))}</title>` +
      `<link>${escapeXml(event.source_url ?? channel.itemFallbackLink)}</link>` +
      `<guid isPermaLink="false">${escapeXml(eventRssGuid(event))}</guid>${pubDate}` +
      `<category>${escapeXml(event.family)}</category>` +
      `<description>${escapeXml(eventRssDescription(event))}</description></item>`
    );
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>${escapeXml(channel.title)}</title><link>${escapeXml(channel.link)}</link>
<description>${escapeXml(channel.description)}</description>
<language>en-us</language><lastBuildDate>${new Date(file.generated_at).toUTCString()}</lastBuildDate><ttl>5</ttl>
${channel.self ? `<atom:link href="${escapeXml(channel.self)}" rel="self" type="application/rss+xml"/>\n` : ""}${items.join("\n")}
</channel></rss>`;
}
