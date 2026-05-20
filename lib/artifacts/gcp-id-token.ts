/**
 * Mint Cloud Run ID tokens for server-to-server calls (render-svc).
 * Mirrors Risk_Models `gcp-cloud-run-id-token.ts` without portal-only debug hooks.
 */

import { GoogleAuth } from "google-auth-library";

function resolveGoogleAuth(): GoogleAuth | null {
  const raw =
    process.env.GCS_SERVICE_ACCOUNT_KEY?.trim() ||
    process.env.GCP_SERVICE_ACCOUNT_JSON?.trim();
  if (raw) {
    try {
      return new GoogleAuth({ credentials: JSON.parse(raw) as object });
    } catch {
      return null;
    }
  }
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (keyFile) {
    return new GoogleAuth({ keyFile });
  }
  return null;
}

/** Bearer token for `targetUrl` (Cloud Run audience), or undefined if no GCP creds. */
export async function authorizationHeaderForCloudRun(
  targetUrl: string,
): Promise<string | undefined> {
  const auth = resolveGoogleAuth();
  if (!auth) {
    return undefined;
  }
  const client = await auth.getIdTokenClient(targetUrl);
  const headers = await client.getRequestHeaders();
  return headers.Authorization;
}
