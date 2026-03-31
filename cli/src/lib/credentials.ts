import { apiRootFromUserBase } from "./api-url.js";
import type { RiskmodelsConfig } from "./config.js";
import { DEFAULT_API_BASE } from "./config.js";
import { fetchOAuthAccessToken, invalidateOAuthToken } from "./oauth.js";

/** Matches sdk/riskmodels/client.py DEFAULT_SCOPE. */
export const DEFAULT_OAUTH_SCOPE =
  "ticker-returns risk-decomposition batch-analysis factor-correlation rankings";

export type ResolvedApiAuth = {
  apiRoot: string;
  /** Static Bearer (API key) — preferred when set */
  apiKey?: string;
  oauth?: { clientId: string; clientSecret: string; scope: string };
};

function trimEnv(key: string): string | undefined {
  const v = process.env[key];
  return v?.trim() || undefined;
}

export function resolveApiAuth(cfg: RiskmodelsConfig | null): ResolvedApiAuth | null {
  const apiRoot = apiRootFromUserBase(cfg?.apiBaseUrl);

  const apiKey = cfg?.apiKey?.trim() || trimEnv("RISKMODELS_API_KEY");
  if (apiKey) {
    return { apiRoot, apiKey };
  }

  const clientId = cfg?.clientId?.trim() || trimEnv("RISKMODELS_CLIENT_ID");
  const clientSecret = cfg?.clientSecret?.trim() || trimEnv("RISKMODELS_CLIENT_SECRET");
  const scope = cfg?.oauthScope?.trim() || trimEnv("RISKMODELS_OAUTH_SCOPE") || DEFAULT_OAUTH_SCOPE;

  if (clientId && clientSecret) {
    return { apiRoot, oauth: { clientId, clientSecret, scope } };
  }

  return null;
}

/** True when user has API key or OAuth credentials (config and/or env). */
export function hasRestApiCredentials(cfg: RiskmodelsConfig | null): boolean {
  return resolveApiAuth(cfg) !== null;
}

/**
 * REST analytics require Bearer auth. Direct (Supabase-only) config is OK if env provides credentials.
 */
export function assertRestApiAuth(cfg: RiskmodelsConfig | null, chalkYellow: (s: string) => string): void {
  if (hasRestApiCredentials(cfg)) return;
  if (cfg?.mode === "direct") {
    console.error(
      chalkYellow(
        "REST API commands need an API key or OAuth client credentials. " +
          "Set RISKMODELS_API_KEY (or RISKMODELS_CLIENT_ID + RISKMODELS_CLIENT_SECRET), " +
          "or run `riskmodels config init` in billed mode.",
      ),
    );
    process.exitCode = 1;
    return;
  }
  console.error(chalkYellow("API credentials not configured. Run: riskmodels config init"));
  process.exitCode = 1;
}

/** Returns auth or sets process.exitCode and prints via assertRestApiAuth. */
export function requireResolvedAuth(
  cfg: RiskmodelsConfig | null,
  chalkYellow: (s: string) => string,
): ResolvedApiAuth | null {
  const auth = resolveApiAuth(cfg);
  if (auth) return auth;
  assertRestApiAuth(cfg, chalkYellow);
  return null;
}

export async function getAuthorizationHeader(auth: ResolvedApiAuth): Promise<Record<string, string>> {
  if (auth.apiKey) {
    return { Authorization: `Bearer ${auth.apiKey}` };
  }
  if (auth.oauth) {
    const token = await fetchOAuthAccessToken(
      auth.apiRoot,
      auth.oauth.clientId,
      auth.oauth.clientSecret,
      auth.oauth.scope,
    );
    return { Authorization: `Bearer ${token}` };
  }
  throw new Error("No API credentials");
}

export function invalidateAuthForRetry(auth: ResolvedApiAuth): void {
  if (auth.oauth) {
    invalidateOAuthToken(auth.apiRoot, auth.oauth.clientId, auth.oauth.scope);
  }
}

/** Public origin for docs (no `/api` suffix). */
export function displayApiOrigin(cfg: RiskmodelsConfig | null): string {
  return (cfg?.apiBaseUrl ?? DEFAULT_API_BASE).replace(/\/$/, "").replace(/\/api$/, "");
}
