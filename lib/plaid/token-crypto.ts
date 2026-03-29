import crypto from "crypto";

function encryptionKey(): Buffer {
  const secret = process.env.PLAID_TOKEN_ENCRYPTION_SECRET;
  if (!secret || secret.length < 8) {
    throw new Error("PLAID_TOKEN_ENCRYPTION_SECRET must be set (min 8 chars)");
  }
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

export interface EncryptedPayload {
  blob: string;
  iv: string;
  tag: string;
}

export function encryptPlaidAccessToken(plain: string): EncryptedPayload {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    blob: enc.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url"),
  };
}

export function decryptPlaidAccessToken(payload: EncryptedPayload): string {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(payload.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.blob, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function serializeEncryptedToken(p: EncryptedPayload): string {
  return JSON.stringify(p);
}

export function parseEncryptedToken(json: string): EncryptedPayload {
  const o = JSON.parse(json) as EncryptedPayload;
  if (!o?.blob || !o?.iv || !o?.tag) {
    throw new Error("Invalid encrypted token payload");
  }
  return o;
}
