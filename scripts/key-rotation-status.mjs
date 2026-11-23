#!/usr/bin/env node
/**
 * RMAPI-32 rotation status: how many unrevoked keys still carry a hash made
 * with the default salt.
 *
 * A key is re-hashed to the configured salt the first time it validates after
 * the rotation started (lib/agent/api-keys.ts). So an unrevoked key created
 * before API_KEY_ROTATION_STARTED_AT and not used since still has a
 * default-salt hash, and stops working when API_KEY_ACCEPT_LEGACY=off.
 *
 *   API_KEY_ROTATION_STARTED_AT=2026-11-24T00:00:00Z \
 *     doppler run -p erm3 -c prd -- node scripts/key-rotation-status.mjs
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Read-only.
 */
import { createClient } from "@supabase/supabase-js";

const started = process.env.API_KEY_ROTATION_STARTED_AT;
if (!started || Number.isNaN(Date.parse(started))) {
  console.error("Set API_KEY_ROTATION_STARTED_AT to the ISO time the new salt went live.");
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });
const since = new Date(started).toISOString();

async function rows(table) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from(table)
      .select("key_hash, created_at, last_used_at, expires_at")
      .is("revoked_at", null)
      .range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

const now = Date.now();
console.log(`rotation started ${since}`);
for (const table of ["agent_api_keys", "user_generated_api_keys"]) {
  const live = (await rows(table)).filter(
    (r) => !String(r.key_hash).startsWith("first-key-pending:") && !(r.expires_at && Date.parse(r.expires_at) < now),
  );
  const onNewSalt = (r) => r.created_at >= since || (r.last_used_at && r.last_used_at >= since);
  const migrated = live.filter(onNewSalt).length;
  const neverUsed = live.filter((r) => !onNewSalt(r) && !r.last_used_at).length;
  const legacy = live.length - migrated;
  console.log(
    `${table}: ${live.length} unrevoked, ${migrated} on the new salt (issued or used since), ${legacy} still on the default salt (${neverUsed} never used)`,
  );
}
