import { apiRootFromUserBase } from "./api-url.js";
import type { RiskmodelsConfig } from "./config.js";
import { DEFAULT_API_BASE } from "./config.js";

/**
 * Auth is a static Bearer API key. There is no token exchange.
 *
 * Removed in 3.0.0: the OAuth client-credentials path. It POSTed a
 * `client_credentials` grant to `{apiRoot}/auth/token`, an endpoint that was
 * documented but never implemented — it returns 404, so any invocation
 * configured that way failed on its first request. The API's only OAuth flow is
 * authorization-code + PKCE for MCP clients, which issues an `rm_user_*` key
 * that is used here as a plain API key.
 */
export type ResolvedApiAuth = {
  apiRoot: string;
  /** Static Bearer (`rm_agent_*` or `rm_user_*`). */
  apiKey: string;
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
          "Set RISKMODELS_API_KEY — get a key at https://riskmodels.app/get-key — " +
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
  return { Authorization: `Bearer ${auth.apiKey}` };
}

/** Public origin for docs (no `/api` suffix). */
export function displayApiOrigin(cfg: RiskmodelsConfig | null): string {
  return (cfg?.apiBaseUrl ?? DEFAULT_API_BASE).replace(/\/$/, "").replace(/\/api$/, "");
}
