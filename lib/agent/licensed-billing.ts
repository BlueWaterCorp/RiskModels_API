import { createAdminClient } from "@/lib/supabase/admin";
import type { RequestFacets } from "./request-facets";

export type BillingMode = "prepaid" | "licensed";

export type LicenseAccount = {
  billingMode: BillingMode;
  licenseTier: string | null;
};

export function shouldSkipCharge(opts: {
  internalUnlimited?: boolean;
  billingMode?: BillingMode | string | null;
}): boolean {
  return Boolean(opts.internalUnlimited) || opts.billingMode === "licensed";
}

/**
 * Licensed accounts skip prepaid deduct / 402. Missing columns (migration not
 * applied) fall back to prepaid so production does not 500.
 */
export async function loadLicenseAccount(userId: string): Promise<LicenseAccount> {
  try {
    const { data, error } = await createAdminClient()
      .from("agent_accounts")
      .select("billing_mode, license_tier")
      .eq("user_id", userId)
      .maybeSingle();

    if (error && (error as { code?: string }).code === "42703") {
      return { billingMode: "prepaid", licenseTier: null };
    }
    if (data?.billing_mode === "licensed") {
      return {
        billingMode: "licensed",
        licenseTier:
          typeof data.license_tier === "string" ? data.license_tier : null,
      };
    }
    return { billingMode: "prepaid", licenseTier: null };
  } catch {
    return { billingMode: "prepaid", licenseTier: null };
  }
}

export function licensedTelemetryMetadata(opts: {
  billingMode: BillingMode;
  licenseTier: string | null;
  listPriceUsd: number;
  keyId?: string | null;
  keyPrefix?: string | null;
  originalUrl: string;
  facets: RequestFacets;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  const meta: Record<string, unknown> = { ...(opts.extra ?? {}) };
  if (opts.billingMode !== "licensed") return meta;
  meta.billing_mode = "licensed";
  meta.license_tier = opts.licenseTier;
  meta.list_price_usd = opts.listPriceUsd;
  if (opts.keyId) meta.key_id = opts.keyId;
  if (opts.keyPrefix) meta.key_prefix = opts.keyPrefix;
  meta.original_url = opts.originalUrl;
  if (opts.facets.tickers.length) meta.tickers = opts.facets.tickers;
  if (opts.facets.item_count != null) meta.item_count = opts.facets.item_count;
  if (opts.facets.as_of) meta.as_of = opts.facets.as_of;
  if (opts.facets.years != null) meta.years = opts.facets.years;
  return meta;
}
