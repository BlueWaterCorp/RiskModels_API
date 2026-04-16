/**
 * Risk Model Metadata (Lineage / Provenance) — Supabase-native for RiskModels_API
 *
 * Same exported interface as Risk_Models/lib/dal/risk-metadata.ts.
 * Gateway client call replaced with direct createAdminClient() queries.
 * Queries mirror those in /api/data/metadata/route.ts.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { RISK_MODEL_VERSION } from "@/lib/constants";

const L3_FACTORS = [
  "SPY", "XLK", "XLF", "XLV", "XLE", "XLI",
  "XLY", "XLP", "XLU", "XLB", "XLRE", "XLC",
] as const;

export interface RiskMetadata {
  model_version: string;
  data_as_of: string;
  factor_set_id: string;
  universe_size: number;
  wiki_uri: string;
  factors: readonly string[];
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let cached: { metadata: RiskMetadata; expiresAt: number } | null = null;

export async function getRiskMetadata(): Promise<RiskMetadata> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.metadata;
  }

  const admin = createAdminClient();

  const { data: latestRow } = await admin
    .from("security_history_latest")
    .select("teo")
    .eq("periodicity", "daily")
    .order("teo", { ascending: false })
    .limit(1)
    .maybeSingle();

  const dataAsOf = latestRow?.teo ?? new Date().toISOString().split("T")[0];

  const { count: universeCount } = await admin
    .from("symbols")
    .select("*", { count: "exact", head: true })
    .eq("asset_type", "stock");

  const metadata: RiskMetadata = {
    model_version: process.env.RISK_MODEL_VERSION ?? RISK_MODEL_VERSION,
    data_as_of: dataAsOf,
    factor_set_id: "SPY_uni_mc_3000",
    universe_size: universeCount ?? 0,
    wiki_uri: "https://riskmodels.net/docs/methodology/erm3-l3",
    factors: L3_FACTORS,
  };

  cached = { metadata, expiresAt: now + CACHE_TTL_MS };
  return metadata;
}
