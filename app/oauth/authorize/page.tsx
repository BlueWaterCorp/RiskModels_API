/**
 * GET /oauth/authorize — OAuth authorization endpoint (authorization_code + PKCE).
 *
 * Flow:
 *  1. Validate the client_id + redirect_uri against the registered client
 *     BEFORE redirecting anywhere (never bounce errors to an unvalidated URI).
 *  2. If the user has no `.app` Supabase session, send them to `.app`'s own
 *     sign-in (`/get-key`) with this authorize URL as `?next=` so they return
 *     here after login. `.net` is never involved.
 *  3. Render a minimal consent screen; "Allow" POSTs to
 *     /api/oauth/authorize/decision, which mints the single-use auth code and
 *     redirects back to the client's redirect_uri.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getClient, redirectUriRegistered, OAUTH_SCOPE } from "@/lib/oauth/server";

export const dynamic = "force-dynamic";

const AUTHORIZE_PARAMS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "scope",
  "state",
] as const;

function str(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function redirectClientError(redirectUri: string, state: string, error: string, desc?: string): never {
  const u = new URL(redirectUri);
  u.searchParams.set("error", error);
  if (desc) u.searchParams.set("error_description", desc);
  if (state) u.searchParams.set("state", state);
  redirect(u.toString());
}

function ErrorCard({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-xl border border-red-900/50 bg-zinc-950 p-6">
        <h1 className="text-lg font-semibold text-red-300">{title}</h1>
        <p className="mt-2 text-sm text-zinc-400">{detail}</p>
      </div>
    </main>
  );
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const responseType = str(sp.response_type);
  const clientId = str(sp.client_id);
  const redirectUri = str(sp.redirect_uri);
  const codeChallenge = str(sp.code_challenge);
  const codeChallengeMethod = str(sp.code_challenge_method) ?? "S256";
  const scope = str(sp.scope) ?? OAUTH_SCOPE;
  const state = str(sp.state) ?? "";

  // 1. Validate client + redirect_uri before trusting them as a redirect target.
  if (!clientId || !redirectUri) {
    return <ErrorCard title="Invalid request" detail="Missing client_id or redirect_uri." />;
  }
  const client = await getClient(clientId);
  if (!client) {
    return <ErrorCard title="Unknown client" detail="This client_id is not registered. Remove and re-add the connector so it can register again." />;
  }
  if (!redirectUriRegistered(client, redirectUri)) {
    return <ErrorCard title="Redirect URI mismatch" detail="The redirect_uri does not match a URI registered for this client." />;
  }

  // From here errors are safe to return to the (validated) client redirect_uri.
  if (responseType !== "code") redirectClientError(redirectUri, state, "unsupported_response_type");
  if (!codeChallenge || codeChallengeMethod !== "S256") {
    redirectClientError(redirectUri, state, "invalid_request", "PKCE S256 code_challenge is required");
  }

  // 2. Require a signed-in .app user; otherwise bounce to .app's own sign-in.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const qs = new URLSearchParams();
    for (const k of AUTHORIZE_PARAMS) {
      const v = str(sp[k]);
      if (v) qs.set(k, v);
    }
    redirect(`/get-key?next=${encodeURIComponent(`/oauth/authorize?${qs.toString()}`)}`);
  }

  // 3. Consent screen — plain server-rendered form, no client JS needed.
  return (
    <main className="min-h-[70vh] flex items-center justify-center px-4 py-10">
      <div className="max-w-md w-full rounded-xl border border-zinc-800 bg-zinc-950 p-6">
        <div className="text-xs uppercase tracking-widest text-zinc-500">RiskModels — authorize access</div>
        <h1 className="mt-2 text-xl font-semibold text-zinc-100">
          {client.client_name ? `"${client.client_name}"` : "An application"} wants to connect
        </h1>
        <p className="mt-3 text-sm text-zinc-400">
          It will be able to <strong className="text-zinc-200">read your risk data</strong> through RiskModels and
          <strong className="text-zinc-200"> bill your account</strong> for metered calls, on your behalf.
        </p>
        <ul className="mt-4 text-sm text-zinc-400 space-y-1">
          <li>• Scope: <code className="text-zinc-300">{scope}</code></li>
          <li>• Signed in as <span className="text-zinc-300">{user.email ?? user.id}</span></li>
        </ul>

        <form method="POST" action="/api/oauth/authorize/decision" className="mt-6 flex gap-3">
          <input type="hidden" name="client_id" value={clientId} />
          <input type="hidden" name="redirect_uri" value={redirectUri} />
          <input type="hidden" name="code_challenge" value={codeChallenge} />
          <input type="hidden" name="code_challenge_method" value={codeChallengeMethod} />
          <input type="hidden" name="scope" value={scope} />
          <input type="hidden" name="state" value={state} />
          <button
            type="submit"
            name="decision"
            value="deny"
            className="flex-1 rounded-lg border border-zinc-700 px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-900 transition-colors"
          >
            Deny
          </button>
          <button
            type="submit"
            name="decision"
            value="approve"
            className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 transition-colors"
          >
            Allow
          </button>
        </form>

        <p className="mt-4 text-xs text-zinc-600">
          You can revoke this access any time from your API keys at{" "}
          <Link href="/get-key" className="text-zinc-400 hover:underline">riskmodels.app/get-key</Link>.
        </p>
      </div>
    </main>
  );
}
