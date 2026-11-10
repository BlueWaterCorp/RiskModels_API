#!/usr/bin/env node
/**
 * Generate a time-limited, scope-limited API key for an institutional trial (for example QuantConnect).
 *
 *   doppler run -p erm3 -c prd -- node scripts/generate-trial-key.mjs \
 *     --name "QuantConnect trial" --days 30 --daily-cap 5 --rate 120 --scopes hedge-basket \
 *     --key-out ~/Downloads/quantconnect_trial_key.txt
 *
 * The plain key is written to --key-out with mode 600 and never printed. The script prints SQL for the Supabase SQL
 * editor that (1) upserts a licensed-mode account for an existing auth user and (2) inserts the key with an expiry,
 * a per-key daily spend cap and a key_scope tag. Create the auth user first (Authentication -> Users) and substitute
 * its id for <TRIAL_USER_ID>. Revoke later with: UPDATE agent_api_keys SET revoked_at = now() WHERE key_prefix = '<prefix>';
 *
 * Needs API_KEY_SECRET (and API_KEY_SALT if set) in the environment; it mirrors lib/agent/api-keys.ts.
 */
import crypto from 'crypto';
import fs from 'fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']);
  return acc;
}, []));
const name = args.name ?? 'Institutional trial';
const days = Number(args.days ?? 30);
const dailyCap = Number(args['daily-cap'] ?? 5);
const rate = Number(args.rate ?? 120);
const scopes = String(args.scopes ?? 'hedge-basket').split(',').map((s) => s.trim()).filter(Boolean);
const tier = args.tier ?? 'desk';
const keyOut = args['key-out'];
if (!keyOut) { console.error('--key-out <file> is required (the plain key is not printed)'); process.exit(1); }
if (!['desk', 'firm', 'production'].includes(tier)) { console.error('--tier must be desk, firm or production'); process.exit(1); }

const SECRET = process.env.API_KEY_SECRET;
if (!SECRET) { console.error('API_KEY_SECRET is not set; run under doppler (prd config).'); process.exit(1); }
const SALT = process.env.API_KEY_SALT ?? SECRET;

const random = crypto.randomBytes(24).toString('base64url').replace(/^_+/, '').replace(/_+$/, '');
const base = `rm_agent_live_${random}`;
let checksum = crypto.createHash('sha256').update(base + SECRET).digest('base64url').substring(0, 8).replace(/_/g, '');
if (checksum.length < 8) checksum += 'x'.repeat(8 - checksum.length);
const plainKey = `${base}_${checksum}`;
const hashed = crypto.createHash('sha256').update(plainKey + SALT).digest('hex');
const prefix = plainKey.substring(0, 16);
fs.writeFileSync(keyOut.replace(/^~/, process.env.HOME), plainKey + '\n', { mode: 0o600 });

const arr = `ARRAY[${scopes.map((s) => `'${s.replace(/'/g, '')}'`).join(',')}]`;
console.log(`-- ${name}: key prefix ${prefix}, scopes ${scopes.join(',')}, expires in ${days} days, daily cap $${dailyCap}, ${rate}/min, tier ${tier}
-- The plain key is in ${keyOut} (mode 600). Replace <TRIAL_USER_ID> with the id of the auth user created for this trial.
DO $$
DECLARE
  _uid uuid := '<TRIAL_USER_ID>';
BEGIN
  INSERT INTO agent_accounts (user_id, billing_mode, license_tier)
  VALUES (_uid, 'licensed', '${tier}')
  ON CONFLICT (user_id) DO UPDATE SET billing_mode = 'licensed', license_tier = '${tier}';

  INSERT INTO agent_api_keys
    (user_id, key_hash, key_prefix, name, scopes, rate_limit_per_minute, expires_at, key_scope, daily_spend_cap_usd)
  VALUES (_uid, '${hashed}', '${prefix}', '${name.replace(/'/g, '')}', ${arr}, ${rate},
          now() + interval '${days} days', 'institutional-trial', ${dailyCap})
  ON CONFLICT (key_hash) DO NOTHING;
END $$;
`);
