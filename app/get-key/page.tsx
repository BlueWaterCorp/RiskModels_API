'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';
import { Copy, Check, Trash2, KeyRound, Mail, LogOut, CreditCard, AlertCircle, Zap, Plus, Pencil } from 'lucide-react';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  status: 'active' | 'expired' | 'revoked';
}

interface AccountInfo {
  balance_usd: number;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  status: string;
}

/** Google “G” mark — same paths as Risk_Models `riskmodels_com` auth modal for visual parity. */
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void copyTextToClipboard(text).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    });
  };
  return (
    <button onClick={copy} className="p-1.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100 transition-colors" title="Copy">
      {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
    </button>
  );
}

function GetKeyPage() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Auth form
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Account + keys
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  // Key generation
  const [newKeyName, setNewKeyName] = useState('');
  const [generating, setGenerating] = useState(false);
  const [revealedKey, setRevealedKey] = useState<{ plainKey: string; name: string } | null>(null);
  const [genError, setGenError] = useState('');

  // Inline rename state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);

  // Stripe flow — matches redirect query params from /api/stripe/setup-success
  const [stripeLoading, setStripeLoading] = useState(false);
  const [stripeSetupError, setStripeSetupError] = useState('');
  const [stripeStatus, setStripeStatus] = useState<
    | 'success'
    | 'cancelled'
    | 'error'
    | 'incomplete'
    | 'account_error'
    | 'key_error'
    | 'processing'
    | null
  >(null);

  // Handle code exchange and stripe query params on mount
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    const code = searchParams.get('code');
    const stripe = searchParams.get('stripe');

    if (stripe) {
      const allowed = new Set([
        'success',
        'cancelled',
        'error',
        'incomplete',
        'account_error',
        'key_error',
        'processing',
      ]);
      setStripeStatus(allowed.has(stripe) ? (stripe as typeof stripeStatus) : 'error');
      router.replace('/get-key');
    }

    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ data, error }) => {
        router.replace('/get-key');
        if (error) {
          setAuthError('Sign-in link expired or already used. Please request a new one.');
          supabase.auth.getUser().then(({ data: { user } }) => {
            setUser(user);
            setLoading(false);
          });
        } else {
          setUser(data.session?.user ?? null);
          setLoading(false);
        }
      });
      return () => subscription.unsubscribe();
    }

    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAccountData = useCallback(async () => {
    setDataLoading(true);
    const [acctRes, keysRes] = await Promise.all([
      fetch('/api/account'),
      fetch('/api/agent-keys'),
    ]);
    if (acctRes.ok) setAccount(await acctRes.json());
    if (keysRes.ok) {
      const data = await keysRes.json();
      setKeys(data.keys ?? []);
    }
    setDataLoading(false);
  }, []);

  useEffect(() => {
    if (user) fetchAccountData();
  }, [user, fetchAccountData]);

  useEffect(() => {
    if (user && stripeStatus === 'success') {
      void fetchAccountData();
    }
  }, [user, stripeStatus, fetchAccountData]);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/get-key` },
    });
    if (error) setAuthError(error.message);
    else setEmailSent(true);
    setAuthLoading(false);
  };

  /** Build at click time only — `window` is undefined during SSR. */
  const oauthRedirectTo = () =>
    `${window.location.origin}/auth/callback?next=/get-key`;

  const signInWithGitHub = async () => {
    setAuthError('');
    await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: oauthRedirectTo() },
    });
  };

  /** Google — same Supabase provider as Risk_Models (`riskmodels_com` auth-context). Enable in Supabase → Authentication → Providers. */
  const signInWithGoogle = async () => {
    setAuthError('');
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: oauthRedirectTo() },
    });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setAccount(null);
    setKeys([]);
    setStripeStatus(null);
  };

  const startStripeSetup = async () => {
    setStripeLoading(true);
    setStripeSetupError('');
    const res = await fetch('/api/stripe/setup-session', { method: 'POST' });
    if (res.ok) {
      const { url } = await res.json();
      window.location.href = url;
    } else {
      let msg = 'Could not start Stripe checkout. Try again or sign out and back in.';
      try {
        const j = (await res.json()) as { error?: string };
        if (j.error) msg = j.error;
      } catch {
        /* ignore */
      }
      setStripeSetupError(msg);
      setStripeLoading(false);
    }
  };

  const generateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenerating(true);
    setGenError('');
    setRevealedKey(null);
    // Pass the user's name if they typed one; otherwise omit so the server
    // auto-numbers ("API Key 1", "API Key 2", …). Sending a literal fallback
    // like "API Key" would override the server's numbering logic.
    const trimmed = newKeyName.trim();
    const res = await fetch('/api/agent-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(trimmed ? { name: trimmed } : {}),
    });
    const data = await res.json();
    if (!res.ok) {
      setGenError(data.error ?? 'Failed to generate key');
    } else {
      setRevealedKey({ plainKey: data.key.plainKey, name: data.key.name });
      setNewKeyName('');
      await fetchAccountData();
    }
    setGenerating(false);
  };

  const revokeKey = async (id: string) => {
    if (!confirm('Revoke this key? Any apps using it will stop working immediately.')) return;
    await fetch('/api/agent-keys', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    await fetchAccountData();
  };

  const startRename = (k: ApiKey) => {
    setRenamingId(k.id);
    setRenameDraft(k.name);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameDraft('');
  };

  const saveRename = async (id: string) => {
    const name = renameDraft.trim();
    if (!name) {
      cancelRename();
      return;
    }
    // No-op if unchanged
    const current = keys.find((k) => k.id === id);
    if (current && current.name === name) {
      cancelRename();
      return;
    }
    setRenameSaving(true);
    try {
      const res = await fetch('/api/agent-keys', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name }),
      });
      if (res.ok) {
        await fetchAccountData();
        cancelRename();
      }
    } finally {
      setRenameSaving(false);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  const formatBalance = (usd: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(usd);

  // Show card CTA only if no Stripe customer yet AND zero balance
  const hasCard = Boolean(account?.stripe_customer_id) || (account?.balance_usd ?? 0) > 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
      </div>
    );
  }

  // ── Signed-out ───────────────────────────────────────────────────────────────
  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-zinc-800 border border-zinc-700 mb-4">
              <KeyRound size={22} className="text-zinc-300" />
            </div>
            <h1 className="text-2xl font-bold text-zinc-100">Get your API key</h1>
            <p className="text-zinc-400 mt-2 text-sm">
              Sign in with Google, GitHub, or email — no password needed.
            </p>
          </div>

          {emailSent ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
              <Mail size={32} className="mx-auto text-blue-400 mb-3" />
              <h2 className="text-zinc-100 font-semibold text-lg mb-2">Check your inbox</h2>
              <p className="text-zinc-400 text-sm">
                We sent a sign-in link to <span className="text-zinc-200 font-medium">{email}</span>. Click it to continue.
              </p>
              <button onClick={() => { setEmailSent(false); setEmail(''); }} className="mt-6 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
                Use a different email
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 space-y-5">
              {authError && (
                <div className="flex items-start gap-2 text-red-400 text-xs bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">
                  <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                  {authError}
                </div>
              )}

              {/* OAuth — Google + GitHub (provider config shared concept with Risk_Models riskmodels_com) */}
              <button
                type="button"
                onClick={signInWithGoogle}
                className="w-full flex items-center justify-center gap-3 py-2.5 rounded-lg bg-white hover:bg-zinc-100 text-zinc-900 font-semibold text-sm transition-colors border border-zinc-200"
              >
                <GoogleIcon className="w-5 h-5 flex-shrink-0" />
                Continue with Google
              </button>

              <button
                type="button"
                onClick={signInWithGitHub}
                className="w-full flex items-center justify-center gap-3 py-2.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-900 font-semibold text-sm transition-colors"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5 flex-shrink-0" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.373 0 12c0 5.303 3.438 9.8 8.205 11.387.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.605-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.298 24 12c0-6.627-5.373-12-12-12z" />
                </svg>
                Continue with GitHub
              </button>

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 border-t border-zinc-700" />
                <span className="text-xs text-zinc-500">or</span>
                <div className="flex-1 border-t border-zinc-700" />
              </div>

              {/* Email magic link — fallback */}
              <form onSubmit={signIn} className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1.5">Email address</label>
                  <input
                    type="email" required value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full px-3 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
                  />
                </div>
                <button type="submit" disabled={authLoading}
                  className="w-full py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-50 text-zinc-100 font-semibold text-sm transition-colors">
                  {authLoading ? 'Sending…' : 'Send magic link'}
                </button>
              </form>

              <p className="text-center text-xs text-zinc-500">New accounts are created automatically.</p>
            </div>
          )}
          <p className="text-xs text-zinc-500 mt-3">
            After sign-in, create or copy your API key from{' '}
            <Link href="/account/usage" className="text-primary hover:underline">
              Account → Usage
            </Link>
            . See{' '}
            <Link href="/docs/authentication" className="text-primary hover:underline">
              Authentication
            </Link>{' '}
            for scopes and billing details.
          </p>
        </div>
      </div>
    );
  }

  // ── Signed-in dashboard ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-950 py-16 px-4">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-zinc-100">API Keys</h1>
            <p className="text-zinc-400 text-sm mt-1">{user.email}</p>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/account/usage"
              className="text-xs font-semibold text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Usage
            </Link>
            {account && hasCard && (
              <span className="text-sm text-zinc-300 font-medium">
                Balance: <span className={account.balance_usd > 0 ? 'text-green-400' : 'text-red-400'}>
                  {formatBalance(account.balance_usd)}
                </span>
              </span>
            )}
            <button onClick={signOut} className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
              <LogOut size={13} /> Sign out
            </button>
          </div>
        </div>

        {/* Stripe success banner */}
        {stripeStatus === 'success' && (
          <div className="mb-6 rounded-xl border border-green-700/40 bg-green-950/20 p-4 flex items-start gap-3">
            <Check size={16} className="text-green-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-green-300 font-semibold text-sm">Card verified — $20 free credits added</p>
              <p className="text-zinc-400 text-xs mt-0.5">Your API key is active below. You won&apos;t be charged until you add more credits.</p>
            </div>
          </div>
        )}

        {stripeStatus === 'cancelled' && (
          <div className="mb-6 rounded-xl border border-zinc-700 bg-zinc-900 p-4 flex items-start gap-3">
            <AlertCircle size={16} className="text-zinc-400 flex-shrink-0 mt-0.5" />
            <p className="text-zinc-400 text-sm">Card setup was cancelled. Add a card below to activate your $20 in free credits.</p>
          </div>
        )}

        {stripeStatus === 'error' && (
          <div className="mb-6 rounded-xl border border-red-800/40 bg-red-950/20 p-4 flex items-start gap-3">
            <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-red-400 text-sm">
              Something went wrong finishing card setup. Try &quot;Add card&quot; again. If it keeps failing, contact support with your sign-in email.
            </p>
          </div>
        )}

        {stripeStatus === 'incomplete' && (
          <div className="mb-6 rounded-xl border border-amber-800/40 bg-amber-950/20 p-4 flex items-start gap-3">
            <AlertCircle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-amber-200/90 text-sm">
              Stripe checkout did not complete. Finish entering your card or try &quot;Add card&quot; again.
            </p>
          </div>
        )}

        {stripeStatus === 'processing' && (
          <div className="mb-6 rounded-xl border border-blue-800/40 bg-blue-950/20 p-4 flex items-start gap-3">
            <AlertCircle size={16} className="text-blue-400 flex-shrink-0 mt-0.5" />
            <p className="text-blue-200/90 text-sm">
              Verification is still finishing (common after Link / SMS). Wait a few seconds and refresh this page — your credits and key should appear once Stripe marks the session complete.
            </p>
          </div>
        )}

        {stripeStatus === 'account_error' && (
          <div className="mb-6 rounded-xl border border-red-800/40 bg-red-950/20 p-4 flex items-start gap-3">
            <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-red-400 text-sm">
              Your card may be saved, but we could not update your billing account. Contact support with your sign-in email so we can link it manually.
            </p>
          </div>
        )}

        {stripeStatus === 'key_error' && (
          <div className="mb-6 rounded-xl border border-amber-800/40 bg-amber-950/20 p-4 flex items-start gap-3">
            <AlertCircle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-amber-200/90 text-sm">
              Card verified and credits should be on your account, but automatic key creation failed. If you see &quot;Generate&quot; below, create a key there; otherwise refresh the page or contact support.
            </p>
          </div>
        )}

        {/* Stripe CTA — shown if no card on file */}
        {!dataLoading && !hasCard && (
          <div className="mb-6 rounded-xl border border-blue-700/40 bg-blue-950/20 p-6">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-900/60 border border-blue-700/40 flex items-center justify-center">
                <Zap size={18} className="text-blue-400" />
              </div>
              <div className="flex-1">
                <h2 className="text-zinc-100 font-semibold text-base mb-1">
                  Get $20 in free API credits
                </h2>
                <p className="text-zinc-400 text-sm mb-4 leading-relaxed">
                  Add a card for identity verification. <strong className="text-zinc-200">You won&apos;t be charged</strong> — the $20 credit is yours to use immediately. Auto-refill kicks in only when you choose to top up.
                </p>
                {stripeSetupError && (
                  <p className="text-red-400 text-xs mb-3 bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">
                    {stripeSetupError}
                  </p>
                )}
                <button onClick={startStripeSetup} disabled={stripeLoading}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors">
                  <CreditCard size={15} />
                  {stripeLoading ? 'Redirecting to Stripe…' : 'Add card & activate $20 credits'}
                </button>
                <p className="text-xs text-zinc-500 mt-3">
                  Secured by Stripe. We never store raw card details.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* One-time key reveal */}
        {revealedKey && (
          <div className="mb-6 rounded-xl border border-green-700/40 bg-green-950/20 p-5">
            <div className="flex items-center gap-2 mb-1">
              <Check size={15} className="text-green-400 flex-shrink-0" />
              <span className="text-green-300 font-semibold text-sm">
                {revealedKey.name} — copy it now
              </span>
            </div>
            <p className="text-zinc-400 text-xs mb-3">
              This is the only time the full key is shown. It cannot be recovered.
            </p>
            <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5">
              <code className="flex-1 text-sm font-mono text-zinc-100 break-all select-all">
                {revealedKey.plainKey}
              </code>
              <CopyButton text={revealedKey.plainKey} />
            </div>
          </div>
        )}

        {/* Generate new key — only shown when card is on file */}
        {hasCard && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 mb-6">
            <h2 className="text-sm font-semibold text-zinc-200 mb-3 flex items-center gap-2">
              <Plus size={14} /> Generate new key
            </h2>
            <form onSubmit={generateKey} className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  maxLength={60}
                  placeholder="Name — e.g. Production, Colab, CI"
                  className="flex-1 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
                />
                <button type="submit" disabled={generating}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors whitespace-nowrap">
                  {generating ? 'Generating…' : 'Generate'}
                </button>
              </div>
              <p className="text-xs text-zinc-500">Leave blank to auto-name (API Key 1, 2, …)</p>
            </form>
            {genError && (
              <p className="text-red-400 text-xs mt-2 bg-red-950/30 border border-red-800/40 rounded px-3 py-1.5">
                {genError}
              </p>
            )}
          </div>
        )}

        {/* API Keys list */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
          <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-200">
              {hasCard ? 'Your API keys' : 'API keys (add card to activate)'}
            </h2>
            <div className="flex items-center gap-3">
              {keys.length > 0 && (
                <span className="text-xs text-zinc-500">
                  {keys.filter(k => k.status === 'active').length} active
                  {keys.filter(k => k.status === 'revoked').length > 0 &&
                    ` · ${keys.filter(k => k.status === 'revoked').length} revoked`}
                </span>
              )}
              {dataLoading && <div className="w-3.5 h-3.5 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />}
            </div>
          </div>

          {!dataLoading && keys.length === 0 ? (
            <div className="px-5 py-10 text-center text-zinc-500 text-sm">
              {hasCard
                ? 'No keys yet — one will appear here after card verification.'
                : 'Add a card above to provision your API key with $20 free credits.'}
            </div>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {keys.map((k) => (
                <li key={k.id} className={`px-5 py-4 flex items-center gap-4 ${k.status === 'revoked' ? 'opacity-50' : ''}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {renamingId === k.id ? (
                        <>
                          <input
                            autoFocus
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveRename(k.id);
                              else if (e.key === 'Escape') cancelRename();
                            }}
                            onBlur={() => saveRename(k.id)}
                            disabled={renameSaving}
                            maxLength={80}
                            className="text-sm font-medium text-zinc-100 bg-zinc-950 border border-zinc-700 rounded px-2 py-0.5 focus:outline-none focus:border-blue-500 min-w-0 flex-1"
                          />
                          <span className="text-xs text-zinc-500">Enter to save · Esc to cancel</span>
                        </>
                      ) : (
                        <>
                          <span className="text-sm font-medium text-zinc-100">{k.name}</span>
                          {k.status !== 'revoked' && (
                            <button
                              onClick={() => startRename(k)}
                              className="p-1 rounded hover:bg-zinc-800 text-zinc-600 hover:text-zinc-300 transition-colors"
                              title="Rename key"
                            >
                              <Pencil size={12} />
                            </button>
                          )}
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium border ${
                            k.status === 'active'
                              ? 'bg-green-900/40 text-green-400 border-green-800/40'
                              : k.status === 'revoked'
                              ? 'bg-red-900/30 text-red-400 border-red-800/40'
                              : 'bg-zinc-800 text-zinc-500 border-zinc-700'
                          }`}>{k.status}</span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap text-xs text-zinc-500">
                      <code className="font-mono text-zinc-400">{k.key_prefix}…</code>
                      <span>Created {formatDate(k.created_at)}</span>
                      {k.last_used_at && <span>Last used {formatDate(k.last_used_at)}</span>}
                      {k.expires_at && <span>Expires {formatDate(k.expires_at)}</span>}
                    </div>
                  </div>
                  {renamingId !== k.id && k.status !== 'revoked' && (
                    <button onClick={() => revokeKey(k.id)}
                      className="p-1.5 rounded hover:bg-red-900/30 text-zinc-600 hover:text-red-400 transition-colors flex-shrink-0"
                      title="Revoke key">
                      <Trash2 size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Usage hint */}
        {hasCard && keys.length > 0 && (
          <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <p className="text-xs text-zinc-500 mb-2 font-medium uppercase tracking-wide">Usage</p>
            <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
              <code className="text-xs font-mono text-zinc-300 flex-1">Authorization: Bearer rm_agent_live_…</code>
              <CopyButton text="Authorization: Bearer rm_agent_live_…" />
            </div>
            <p className="text-xs text-zinc-400 mt-3 leading-relaxed">
              <strong className="text-zinc-300">Reading the prefix:</strong> keys from this page are{' '}
              <code className="text-zinc-300 font-mono">rm_agent_live_…</code>.{' '}
              <strong className="text-zinc-300">agent</strong> means this key is in the prepaid / metered API program (scripts, SDK, CLI, and MCP all use the same shape — not “AI agents only”).{' '}
              <strong className="text-zinc-300">live</strong> means production data at{' '}
              <code className="text-zinc-400 font-mono">riskmodels.app</code>. It is not a second, separate “type” of key.
            </p>
            <p className="text-xs text-zinc-500 mt-2">
              See the{' '}
              <Link href="/docs/authentication" className="text-blue-400 hover:text-blue-300">Authentication guide</Link>
              {' '}for OAuth2, scopes, and rate limits.
            </p>
          </div>
        )}

      </div>
    </div>
  );
}

export default function GetKeyPageWrapper() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
      </div>
    }>
      <GetKeyPage />
    </Suspense>
  );
}
