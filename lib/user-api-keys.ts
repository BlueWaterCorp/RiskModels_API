import crypto from 'crypto';
import { apiKeyChecksumSecret, apiKeyHashSalt, hashKeyWithSalt } from '@/lib/agent/key-secrets';

export interface UserApiKeyResult {
  plainKey: string;
  hashedKey: string;
  prefix: string;
}

/** Strip `-` from a base64url string so keys are clean alphanumeric + `_` only */
function toAlphanumeric(b64url: string): string {
  return b64url.replace(/-/g, 'x');
}

export function generateUserApiKey(environment: 'live' | 'test' = 'live'): UserApiKeyResult {
  const env = environment === 'live' ? 'live' : 'test';
  const random = toAlphanumeric(crypto.randomBytes(24).toString('base64url'));
  const prefix = `rm_user_${env}`;
  const keyWithoutChecksum = `${prefix}_${random}`;

  const checksum = toAlphanumeric(
    crypto
      .createHash('sha256')
      .update(keyWithoutChecksum + apiKeyChecksumSecret())
      .digest('base64url')
      .substring(0, 8)
  );

  const plainKey = `${keyWithoutChecksum}_${checksum}`;
  const hashedKey = hashApiKey(plainKey);

  return {
    plainKey,
    hashedKey,
    prefix: plainKey.substring(0, 16),
  };
}

/** Stored hash under the current salt. Lookups go through `apiKeyHashCandidates` (RMAPI-32). */
export function hashApiKey(plainKey: string): string {
  return hashKeyWithSalt(plainKey, apiKeyHashSalt());
}
