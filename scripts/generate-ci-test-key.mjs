#!/usr/bin/env node
/**
 * Generate a CI/smoke-test API key for use as the TEST_API_KEY GitHub secret.
 *
 * Usage:
 *   API_KEY_SECRET=<your-secret> node scripts/generate-ci-test-key.mjs
 *
 *   Or source your env first:
 *   source <(grep -E '^API_KEY_SECRET|^API_KEY_SALT' .env.local | sed 's/^/export /') \
 *     && node scripts/generate-ci-test-key.mjs
 *
 * The script prints:
 *   1. The plain key to paste into GitHub Secrets as TEST_API_KEY
 *   2. Ready-to-run SQL for the Supabase SQL editor that:
 *      - Accepts a user_id (your admin account or a dedicated CI user)
 *      - Upserts agent_accounts with $9999 balance so billing never blocks the key
 *      - Inserts the key into agent_api_keys
 */

import crypto from 'crypto';

const API_KEY_SECRET = process.env.API_KEY_SECRET ?? 'default-secret';
const API_KEY_SALT   = process.env.API_KEY_SALT   ?? API_KEY_SECRET;

if (API_KEY_SECRET === 'default-secret') {
  console.warn('\n⚠️  API_KEY_SECRET not set — key will not validate against production.\n' +
    '   Source .env.local before running:\n' +
    '   source <(grep -E \'^API_KEY_SECRET|^API_KEY_SALT\' .env.local | sed \'s/^/export /\') \\\n' +
    '     && node scripts/generate-ci-test-key.mjs\n');
}

// ── Key generation (mirrors lib/agent/api-keys.ts) ──────────────────────────

function generateApiKey(environment = 'live') {
  const env    = environment === 'live' ? 'live' : 'test';
  const random = crypto.randomBytes(24).toString('base64url')
    .replace(/^_+/, '').replace(/_+$/, '');
  const keyWithoutChecksum = `rm_agent_${env}_${random}`;

  let checksum = crypto.createHash('sha256')
    .update(keyWithoutChecksum + API_KEY_SECRET)
    .digest('base64url')
    .substring(0, 8)
    .replace(/_/g, '');
  if (checksum.length < 8) checksum += 'x'.repeat(8 - checksum.length);

  const plainKey  = `${keyWithoutChecksum}_${checksum}`;
  const hashedKey = hashApiKey(plainKey);
  return { plainKey, hashedKey, keyPrefix: plainKey.substring(0, 16) };
}

function hashApiKey(plainKey) {
  return crypto.createHash('sha256').update(plainKey + API_KEY_SALT).digest('hex');
}

const { plainKey, hashedKey, keyPrefix } = generateApiKey('live');

// ── Output ───────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════');
console.log(' CI Test API Key');
console.log('══════════════════════════════════════════════════════════\n');
console.log('1. Add this to GitHub → Settings → Secrets → Actions as TEST_API_KEY:\n');
console.log(`   ${plainKey}\n`);
console.log(`   Key prefix : ${keyPrefix}`);
console.log(`   Key hash   : ${hashedKey}\n`);

console.log('══════════════════════════════════════════════════════════');
console.log(' Supabase SQL  (run in the SQL editor for project plurbatnjhpullghyhol)');
console.log('══════════════════════════════════════════════════════════\n');

// Emit SQL — user substitutes their real user_id.
console.log(`-- Step 1: find the user_id for your admin / CI account
--   (Authentication → Users in the Supabase dashboard, or run:)
--
--   SELECT id FROM auth.users WHERE email = 'your-email@example.com';
--
-- Then paste it below in place of <YOUR_USER_ID>.

DO $$
DECLARE
  _uid  uuid := '<YOUR_USER_ID>';   -- ← replace with real user id
  _name text := 'CI Smoke Test Key';
BEGIN

  -- Give the account a large balance so billing never blocks CI
  INSERT INTO agent_accounts (user_id, balance_usd, total_spent_usd)
  VALUES (_uid, 9999.00, 0.00)
  ON CONFLICT (user_id)
  DO UPDATE SET balance_usd = GREATEST(agent_accounts.balance_usd, 9999.00);

  -- Insert the key (idempotent — safe to re-run)
  INSERT INTO agent_api_keys
    (user_id, key_hash, key_prefix, name, scopes, rate_limit_per_minute)
  VALUES (
    _uid,
    '${hashedKey}',
    '${keyPrefix}',
    _name,
    ARRAY['read','tickers','estimate','metrics','l3-decomposition','auth'],
    300   -- generous limit for CI bursts
  )
  ON CONFLICT (key_hash) DO NOTHING;

  RAISE NOTICE 'CI key ready for user %', _uid;
END $$;
`);

console.log('══════════════════════════════════════════════════════════\n');
console.log('After running the SQL, verify with:');
console.log(`  curl -H "Authorization: Bearer ${plainKey.substring(0, 20)}..." \\`);
console.log('    https://riskmodels.app/api/tickers?search=AAPL\n');
