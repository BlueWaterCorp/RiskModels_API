'use client';

import { useCallback, useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';

interface OrgSummary {
  id: string;
  name: string;
  role: 'admin' | 'member' | null;
  relation: 'member' | 'joinable';
  active: boolean;
  expires_at: string | null;
  balance_usd?: number;
  daily_spend_cap_usd?: number | null;
  daily_spend_today_usd?: number;
}

interface OrgMember {
  user_id: string;
  email: string;
  role: 'admin' | 'member';
  status: 'active' | 'removed';
  active_keys: number;
}

/**
 * Org keys on /get-key: create a key billed to an org you belong to, join an
 * org your verified company email is allowlisted for, or redeem a seat code.
 * Org admins can add and remove members here. Renders nothing extra for users
 * with no org and no code.
 */
export function OrgKeyPanel({
  keyName,
  onKeyCreated,
}: {
  keyName: string;
  onKeyCreated: (key: { plainKey: string; name: string }) => void | Promise<void>;
}) {
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [seatCode, setSeatCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [manageId, setManageId] = useState<string | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [addEmail, setAddEmail] = useState('');

  const loadOrgs = useCallback(async () => {
    const res = await fetch('/api/orgs');
    if (res.ok) setOrgs(((await res.json()).orgs ?? []) as OrgSummary[]);
  }, []);

  useEffect(() => {
    void loadOrgs();
  }, [loadOrgs]);

  const loadMembers = useCallback(async (orgId: string) => {
    const res = await fetch(`/api/orgs/${orgId}/members`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? 'Could not load members');
      return;
    }
    setMembers((data.members ?? []) as OrgMember[]);
  }, []);

  const createKey = async (payload: { org_id?: string; seat_code?: string }, busyKey: string) => {
    setBusy(busyKey);
    setError('');
    const body: Record<string, unknown> = { ...payload };
    if (keyName.trim()) body.name = keyName.trim();
    const res = await fetch('/api/agent-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setError(data.error ?? 'Failed to create key');
      return;
    }
    setSeatCode('');
    await onKeyCreated({ plainKey: data.key.plainKey, name: data.key.name });
    await loadOrgs();
  };

  const removeMember = async (orgId: string, userId: string, email: string) => {
    if (!window.confirm(`Remove ${email}? Their keys for this organization stop working immediately.`)) return;
    setBusy(`remove-${userId}`);
    setError('');
    const res = await fetch(`/api/orgs/${orgId}/members`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) setError(data.error ?? 'Could not remove member');
    await loadMembers(orgId);
  };

  const addMember = async (orgId: string) => {
    setBusy('add');
    setError('');
    const res = await fetch(`/api/orgs/${orgId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: addEmail }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setError(data.message ? `${data.error}. ${data.message}` : (data.error ?? 'Could not add member'));
      return;
    }
    setAddEmail('');
    await loadMembers(orgId);
  };

  // No org and no code entry open: a single link, so personal-only users see
  // the page as before.
  if (orgs.length === 0 && !showCode) {
    return (
      <p className="-mt-3 mb-6 text-xs text-zinc-500">
        <button type="button" onClick={() => setShowCode(true)} className="text-blue-300 underline">
          Have an organization seat code?
        </button>
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 mb-6">
      <h2 className="text-sm font-semibold text-zinc-200 mb-3 flex items-center gap-2">
        <Building2 size={14} /> Organization keys
      </h2>
      {orgs.length === 0 && (
        <p className="text-xs text-zinc-500 mb-2">
          A seat code from your organization creates a key billed to its account.
        </p>
      )}
      <ul className="space-y-3">
        {orgs.map((org) => (
          <li key={org.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-zinc-200">
                {org.name}
                <span className="ml-2 text-xs text-zinc-500">
                  {org.relation === 'joinable' ? 'available to your email domain' : org.role}
                  {org.expires_at ? ` · access until ${new Date(org.expires_at).toLocaleDateString()}` : ''}
                </span>
              </div>
              <button
                type="button"
                disabled={busy !== null || !org.active}
                onClick={() => void createKey({ org_id: org.id }, org.id)}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold text-xs"
              >
                {busy === org.id
                  ? 'Creating…'
                  : org.relation === 'joinable'
                    ? `Join and create key`
                    : `Create key billed to ${org.name}`}
              </button>
            </div>
            {org.role === 'admin' && (
              <div className="mt-2 text-xs text-zinc-400">
                {typeof org.balance_usd === 'number' && <>Balance ${org.balance_usd.toFixed(2)}</>}
                {org.daily_spend_cap_usd != null && (
                  <> · today ${(org.daily_spend_today_usd ?? 0).toFixed(2)} of ${org.daily_spend_cap_usd.toFixed(2)} daily cap</>
                )}
                <button
                  type="button"
                  className="ml-3 text-blue-300 underline"
                  onClick={() => {
                    const next = manageId === org.id ? null : org.id;
                    setManageId(next);
                    if (next) void loadMembers(next);
                  }}
                >
                  {manageId === org.id ? 'Hide members' : 'Manage members'}
                </button>
              </div>
            )}
            {manageId === org.id && (
              <div className="mt-3 space-y-2">
                <table className="w-full text-xs text-zinc-400">
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.user_id} className="border-t border-zinc-800">
                        <td className="py-1.5">{m.email}</td>
                        <td className="py-1.5">{m.role}</td>
                        <td className="py-1.5">{m.status === 'removed' ? 'removed' : `${m.active_keys} key(s)`}</td>
                        <td className="py-1.5 text-right">
                          {m.status === 'active' && (
                            <button
                              type="button"
                              disabled={busy !== null}
                              onClick={() => void removeMember(org.id, m.user_id, m.email)}
                              className="text-red-400 underline disabled:opacity-50"
                            >
                              Remove
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={addEmail}
                    onChange={(e) => setAddEmail(e.target.value)}
                    placeholder="colleague@company.com"
                    className="flex-1 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-500 text-xs"
                  />
                  <button
                    type="button"
                    disabled={busy !== null || !addEmail.includes('@')}
                    onClick={() => void addMember(org.id)}
                    className="px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-200 text-xs disabled:opacity-50"
                  >
                    Add member
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {showCode ? (
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={seatCode}
            onChange={(e) => setSeatCode(e.target.value)}
            maxLength={32}
            placeholder="Seat code"
            className="flex-1 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-500 text-sm uppercase"
          />
          <button
            type="button"
            disabled={busy !== null || seatCode.trim().length < 6}
            onClick={() => void createKey({ seat_code: seatCode.trim() }, 'seat')}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold text-sm"
          >
            {busy === 'seat' ? 'Creating…' : 'Redeem'}
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setShowCode(true)} className="mt-3 text-xs text-blue-300 underline">
          Have an organization seat code?
        </button>
      )}
      {error && (
        <p className="text-red-400 text-xs mt-2 bg-red-950/30 border border-red-800/40 rounded px-3 py-1.5">{error}</p>
      )}
    </div>
  );
}
