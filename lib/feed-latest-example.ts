/**
 * The newest public Event Ledger event, for the landing page feed section.
 *
 * Server only. Reads public.event_ledger with the service role key and builds
 * the same client-gated public file as scripts/event-ledger-digest.ts
 * --public-json (lib/event-ledger-public.ts), then runs the same output checks
 * on it. Any failure, a missing env, or an empty ledger returns null: the
 * section then shows no example. Nothing is ever substituted.
 */

import { loadPublicLatest, type PublicLatestEvent } from "@/lib/event-ledger-public";
import { priceOrCapHits, restrictedWordHits, type LedgerRow } from "@/lib/event-ledger-digest";

/** Seconds a fetched example is reused before the ledger is read again. */
export const FEED_EXAMPLE_REVALIDATE_SECONDS = 3600;

const PAGE = 1000;

function supabaseEnv(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

export async function getLatestFeedExample(): Promise<PublicLatestEvent | null> {
  const env = supabaseEnv();
  if (!env) return null;
  const getRows = async (query: string): Promise<LedgerRow[]> => {
    const rows: LedgerRow[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const res = await fetch(
        `${env.url}/rest/v1/event_ledger?select=seq,published_at,envelope&${query}&order=seq.asc&limit=${PAGE}&offset=${offset}`,
        {
          headers: { apikey: env.key, Authorization: `Bearer ${env.key}` },
          next: { revalidate: FEED_EXAMPLE_REVALIDATE_SECONDS },
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!res.ok) throw new Error(`event_ledger_read_failed_${res.status}`);
      const page = (await res.json()) as LedgerRow[];
      rows.push(...page);
      if (page.length < PAGE) return rows;
    }
  };
  try {
    const file = await loadPublicLatest(getRows, { generatedAt: new Date().toISOString(), count: 1 });
    const event = file.events[0] ?? null;
    if (!event) return null;
    const body = JSON.stringify(event);
    if (restrictedWordHits(body).length || priceOrCapHits(body).length) return null;
    return event;
  } catch {
    return null;
  }
}
