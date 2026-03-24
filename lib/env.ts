// Env shim for migrated agent and DAL files.
// RiskModels_API reads process.env directly; this object provides the same
// shape that copied files expect from @/lib/env.
export const env = {
  // Rate limiting (rate-limiter.ts)
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  // Supabase (secmaster.ts)
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

// Re-export the gateway service key helper used by api-gateway-client in Risk_Models.
// Not used in RiskModels_API itself but exported so any copied file that imports it compiles.
export function riskmodelsGatewayServiceKey(): string | undefined {
  return process.env.RISKMODELS_API_SERVICE_KEY;
}
