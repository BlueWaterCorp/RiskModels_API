import "server-only";

import { cache } from "react";
import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";
import type { Database } from "@/types/secmaster";

type InstrumentRow = Database["secmaster"]["Views"]["instruments"]["Row"];
type InstrumentWithFreshness = InstrumentRow & { isStale: boolean };

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function getSecmasterClient() {
  const apiKey = env.SUPABASE_SERVICE_ROLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    apiKey,
    {
      db: {
        schema: "secmaster",
      },
    },
  );
}

function isInstrumentStale(lastSyncAt: InstrumentRow["last_sync_at"]): boolean {
  if (!lastSyncAt) {
    return true;
  }

  const lastSyncMs = Date.parse(lastSyncAt);

  if (Number.isNaN(lastSyncMs)) {
    return true;
  }

  return Date.now() - lastSyncMs > STALE_AFTER_MS;
}

export const getInstrument = cache(async function getInstrument(
  ticker: string,
): Promise<InstrumentWithFreshness | null> {
  const normalizedTicker = ticker.trim().toUpperCase();

  if (!normalizedTicker) {
    return null;
  }

  const { data, error } = await getSecmasterClient()
    .from("instruments")
    .select("*")
    .eq("ticker", normalizedTicker)
    .maybeSingle();

  if (error) {
    console.error(
      `Error fetching SecMaster instrument data for ${normalizedTicker}:`,
      error,
    );
    return null;
  }

  if (!data) {
    return null;
  }

  return {
    ...data,
    isStale: isInstrumentStale(data.last_sync_at),
  } satisfies InstrumentWithFreshness;
});
