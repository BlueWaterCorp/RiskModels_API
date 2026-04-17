import { describe, expect, it } from "vitest";
import crypto from "crypto";
import { generateApiKey, isValidApiKeyFormat } from "@/lib/agent/api-keys";

// Reproduce legacy checksum logic (pre-dash-strip) so we can synthesize
// a representative legacy key and confirm the validator still accepts it.
function legacyChecksumForPrefix(prefix: string, random: string): string {
  const keyWithoutChecksum = `${prefix}_${random}`;
  const hashInput =
    keyWithoutChecksum + (process.env.API_KEY_SECRET || "default-secret");
  let checksum = crypto
    .createHash("sha256")
    .update(hashInput)
    .digest("base64url")
    .substring(0, 8)
    .replace(/_/g, ""); // legacy: only `_` stripped
  if (checksum.length < 8) {
    checksum += "x".repeat(8 - checksum.length);
  }
  return checksum;
}

describe("api-key checksum alphabet", () => {
  it("newly-issued keys contain no dashes", () => {
    // Generate a batch so a key whose raw digest contains '-' is likely to surface.
    for (let i = 0; i < 200; i++) {
      const { plainKey } = generateApiKey("live");
      // Full key contains no `-` or `_` in the random or checksum segments.
      expect(plainKey).toMatch(/^rm_agent_live_[A-Za-z0-9]{32}_[A-Za-z0-9x]{8}$/);
      expect(plainKey).not.toContain("-");
    }
  });

  it("round-trips: a freshly-generated key validates", () => {
    for (let i = 0; i < 50; i++) {
      const { plainKey } = generateApiKey("live");
      expect(isValidApiKeyFormat(plainKey)).toBe(true);
    }
  });

  it("accepts legacy keys whose checksum segment contains `-`", () => {
    // Search for a (prefix, random) combination whose legacy checksum
    // contains a dash, then verify the current validator still accepts it.
    let found: { key: string; checksum: string } | null = null;
    for (let i = 0; i < 2000 && !found; i++) {
      const random = crypto.randomBytes(24).toString("base64url").replace(/^_+|_+$/g, "");
      const prefix = "rm_agent_live";
      const legacy = legacyChecksumForPrefix(prefix, random);
      if (legacy.includes("-")) {
        found = { key: `${prefix}_${random}_${legacy}`, checksum: legacy };
      }
    }
    // In the unlikely event we didn't find one, skip gracefully rather than flake.
    if (!found) return;
    expect(found.checksum).toContain("-");
    expect(isValidApiKeyFormat(found.key)).toBe(true);
  });

  it("rejects keys with a random-bit-flip in the checksum", () => {
    const { plainKey } = generateApiKey("live");
    const parts = plainKey.split("_");
    // flip a character in the checksum (last segment)
    const cs = parts[parts.length - 1];
    const flipped = (cs[0] === "a" ? "b" : "a") + cs.slice(1);
    parts[parts.length - 1] = flipped;
    const tampered = parts.join("_");
    expect(isValidApiKeyFormat(tampered)).toBe(false);
  });
});
