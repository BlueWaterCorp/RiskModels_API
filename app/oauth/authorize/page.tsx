/**
 * GET /oauth/authorize — OAuth authorization endpoint (authorization_code + PKCE).
 *
 * Flow:
 *  1. Validate the client_id + redirect_uri against the registered client
 *     BEFORE redirecting anywhere (never bounce errors to an unvalidated URI).
 *  2. If the user has no `.app` Supabase session, render a server-side email +
 *     password form on this page (no client JS, no magic link). Directory
 *     reviewers sign in with the account supplied in the submission. Google,
 *     GitHub, and email-link sign-in stay one link away at `/get-key`.
 *  3. Render a minimal consent screen that names the signed-in account;
 *     "Allow" POSTs to /api/oauth/authorize/decision, which mints the
 *     single-use auth code and redirects back to the client's redirect_uri.
 *     "Use a different account" POSTs to /api/oauth/authorize/switch-account,
 *     which signs this browser out and returns here, so the password form
 *     is what the next account sees.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { appOrigin, getClient, redirectUriRegistered, OAUTH_SCOPE } from "@/lib/oauth/server";
import { AUTHORIZE_PARAMS, signInPathFor } from "@/lib/oauth/authorize-return";

export const dynamic = "force-dynamic";

function str(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

// Error responses carry `iss` (RFC 9207) like the success redirect in
// /api/oauth/authorize/decision.
async function redirectClientError(redirectUri: string, state: string, error: string, desc?: string): Promise<never> {
  const u = new URL(redirectUri);
  u.searchParams.set("error", error);
  if (desc) u.searchParams.set("error_description", desc);
  if (state) u.searchParams.set("state", state);
  u.searchParams.set("iss", await appOrigin());
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
  if (responseType !== "code") await redirectClientError(redirectUri, state, "unsupported_response_type");
  if (!codeChallenge || codeChallengeMethod !== "S256") {
    await redirectClientError(redirectUri, state, "invalid_request", "PKCE S256 code_challenge is required");
  }

  // 2. No session: email + password in the first HTML response. Reviewers
  //    (and anyone with a password) can submit without JavaScript, a magic
  //    link, or a hidden toggle. Google / email-link stays on /get-key.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const loginError = str(sp.login_error);
    return (
      <main className="min-h-[70vh] flex items-center justify-center px-4 py-10">
        <div className="max-w-md w-full rounded-xl border border-zinc-800 bg-zinc-950 p-6">
          <div className="text-xs uppercase tracking-widest text-zinc-500">RiskModels — sign in</div>
          <h1 className="mt-2 text-xl font-semibold text-zinc-100">Sign in to connect</h1>
          <p className="mt-3 text-sm text-zinc-400">
            Use the email and password for this RiskModels account. No email link, code, or extra verification.
          </p>
          {loginError === "rate" ? (
            <p className="mt-4 text-sm text-amber-200/90" data-testid="oauth-login-error">
              Too many sign-in attempts. Wait a few minutes and try again.
            </p>
          ) : loginError ? (
            <p className="mt-4 text-sm text-red-300" data-testid="oauth-login-error">
              That email or password did not match.
            </p>
          ) : null}
          <form method="POST" action="/api/oauth/authorize/password" className="mt-5 space-y-3">
            {AUTHORIZE_PARAMS.map((k) => {
              const v = str(sp[k]);
              return v ? <input key={k} type="hidden" name={k} value={v} /> : null;
            })}
            <div>
              <label htmlFor="oauth-email" className="block text-sm font-medium text-zinc-300 mb-1.5">
                Email
              </label>
              <input
                id="oauth-email"
                name="email"
                type="email"
                required
                autoComplete="username"
                className="w-full px-3 py-2.5 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-100 text-sm"
              />
            </div>
            <div>
              <label htmlFor="oauth-password" className="block text-sm font-medium text-zinc-300 mb-1.5">
                Password
              </label>
              <input
                id="oauth-password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="w-full px-3 py-2.5 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-100 text-sm"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 transition-colors"
            >
              Sign in
            </button>
          </form>
          <p className="mt-4 text-xs text-zinc-500">
            <Link href={signInPathFor(sp)} className="text-zinc-400 hover:underline">
              Use Google, GitHub, or an email link instead
            </Link>
          </p>
        </div>
      </main>
    );
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
        <div
          data-testid="oauth-signed-in-as"
          className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5"
        >
          <p className="min-w-0 text-sm text-zinc-400">
            Signed in as{" "}
            <strong className="break-all font-medium text-zinc-100">{user.email ?? user.id}</strong>
          </p>
          <form method="POST" action="/api/oauth/authorize/switch-account" className="shrink-0">
            {AUTHORIZE_PARAMS.map((k) => {
              const v = str(sp[k]);
              return v ? <input key={k} type="hidden" name={k} value={v} /> : null;
            })}
            <button
              type="submit"
              data-testid="oauth-switch-account"
              className="text-xs font-medium text-sky-400 hover:text-sky-300 hover:underline"
            >
              Use a different account
            </button>
          </form>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          The connection will use this account&apos;s data, positions and billing. If this is not the account you
          meant, switch before you allow.
        </p>
        <ul className="mt-4 text-sm text-zinc-400 space-y-1">
          <li>• Scope: <code className="text-zinc-300">{scope}</code></li>
        </ul>

        <div className="mt-4 rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2">
          <p className="text-xs text-amber-200/90">
            Access will be sent to <code className="text-amber-100">{(() => { try { return new URL(redirectUri).host; } catch { return redirectUri; } })()}</code>.
            Only approve if you recognize this destination.
          </p>
        </div>

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
