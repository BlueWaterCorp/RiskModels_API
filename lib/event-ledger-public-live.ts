import { loadPublicLatest } from "@/lib/event-ledger-public";
import { priceOrCapHits, restrictedWordHits, type LedgerRow } from "@/lib/event-ledger-digest";

/** Server-side read only. Only the existing client-safe projection leaves this module. */
export async function loadPublicLedgerSnapshot() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("event_ledger_unavailable");
  const getRows = async (query: string): Promise<LedgerRow[]> => {
    const rows: LedgerRow[] = [];
    for (let offset = 0; offset < 100_000; offset += 1000) {
      const response = await fetch(
        `${url.replace(/\/$/, "")}/rest/v1/event_ledger?select=seq,published_at,envelope&${query}&order=seq.asc&limit=1000&offset=${offset}`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store", signal: AbortSignal.timeout(15_000) },
      );
      if (!response.ok) throw new Error("event_ledger_read_failed");
      const page = await response.json();
      if (!Array.isArray(page)) throw new Error("event_ledger_read_failed");
      rows.push(...page);
      if (page.length < 1000) return rows;
    }
    throw new Error("event_ledger_read_limit");
  };
  const snapshot = await loadPublicLatest(getRows, { generatedAt: new Date().toISOString() });
  const body = JSON.stringify(snapshot);
  if (restrictedWordHits(body).length || priceOrCapHits(body).length) throw new Error("event_ledger_output_refused");
  return snapshot;
}
