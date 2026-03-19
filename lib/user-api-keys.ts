import crypto from 'crypto';

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
      .update(keyWithoutChecksum + (process.env.API_KEY_SECRET || 'default-secret'))
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

export function hashApiKey(plainKey: string): string {
  const salt = process.env.API_KEY_SALT || process.env.API_KEY_SECRET || 'default-salt';
  return crypto.createHash('sha256').update(plainKey + salt).digest('hex');
}
