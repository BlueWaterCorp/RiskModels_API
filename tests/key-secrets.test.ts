import { createHash } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetKeySecretReport,
  apiKeyChecksumSecret,
  apiKeyHashSalt,
} from "@/lib/agent/key-secrets";
import { generateApiKey, hashApiKey, isValidApiKeyFormat } from "@/lib/agent/api-keys";
import { generateUserApiKey, hashApiKey as hashUserKey } from "@/lib/user-api-keys";

/** The formulas on main before this module existed, written out literally. */
const mainHash = (key: string, salt: string) => createHash("sha256").update(key + salt).digest("hex");
function mainChecksum(keyWithoutChecksum: string, secret: string): string {
  let c = createHash("sha256")
    .update(keyWithoutChecksum + secret)
    .digest("base64url")
    .substring(0, 8)
    .replace(/[_-]/g, "");
  if (c.length < 8) c += "x".repeat(8 - c.length);
  return c;
}

describe("API key secrets", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    __resetKeySecretReport();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("production with the variables unset (how production runs today)", () => {
    beforeEach(() => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("API_KEY_SECRET", "");
      vi.stubEnv("API_KEY_SALT", "");
    });

    it("does not throw and returns the built-in defaults", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect(apiKeyChecksumSecret()).toBe("default-secret");
      expect(apiKeyHashSalt()).toBe("default-salt");
    });

    it("a key generated on the defaults validates, with the same hash and checksum as on main", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      for (let i = 0; i < 50; i++) {
        const { plainKey, hashedKey } = generateApiKey("live");
        expect(isValidApiKeyFormat(plainKey)).toBe(true);
        expect(hashedKey).toBe(mainHash(plainKey, "default-salt"));
        expect(hashApiKey(plainKey)).toBe(hashedKey);
        const cut = plainKey.lastIndexOf("_");
        expect(plainKey.slice(cut + 1)).toBe(mainChecksum(plainKey.slice(0, cut), "default-secret"));
      }
    });

    it("an existing stored hash made with the default salt still matches", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const existing = `rm_agent_live_${"a".repeat(32)}_${mainChecksum(`rm_agent_live_${"a".repeat(32)}`, "default-secret")}`;
      expect(isValidApiKeyFormat(existing)).toBe(true);
      expect(hashApiKey(existing)).toBe(mainHash(existing, "default-salt"));
    });

    it("rm_user keys: same defaults, same hash as on main", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { plainKey, hashedKey } = generateUserApiKey("live");
      expect(hashedKey).toBe(mainHash(plainKey, "default-salt"));
      expect(hashUserKey(plainKey)).toBe(hashedKey);
    });

    it("logs one console.error per process, with no secret value in it", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      for (let i = 0; i < 5; i++) {
        apiKeyChecksumSecret();
        apiKeyHashSalt();
        generateApiKey("live");
      }
      expect(spy).toHaveBeenCalledTimes(1);
      const line = String(spy.mock.calls[0]![0]);
      expect(line).toMatch(/built-in defaults/);
      expect(line).not.toContain("default-secret");
      expect(line).not.toContain("default-salt");
    });
  });

  describe("variables set", () => {
    it("uses API_KEY_SECRET for both when API_KEY_SALT is unset, and logs nothing", () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("API_KEY_SECRET", "s3cret");
      vi.stubEnv("API_KEY_SALT", "");
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(apiKeyChecksumSecret()).toBe("s3cret");
      expect(apiKeyHashSalt()).toBe("s3cret");
      expect(hashApiKey("rm_agent_live_abc")).toBe(mainHash("rm_agent_live_abc", "s3cret"));
      expect(hashUserKey("rm_agent_live_abc")).toBe(mainHash("rm_agent_live_abc", "s3cret"));
      expect(spy).not.toHaveBeenCalled();
    });

    it("prefers API_KEY_SALT for the hash", () => {
      vi.stubEnv("API_KEY_SECRET", "s3cret");
      vi.stubEnv("API_KEY_SALT", "salty");
      expect(apiKeyHashSalt()).toBe("salty");
      const { plainKey } = generateApiKey("live");
      expect(isValidApiKeyFormat(plainKey)).toBe(true);
    });
  });

  it("outside production the defaults are used silently", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("API_KEY_SECRET", "");
    vi.stubEnv("API_KEY_SALT", "");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(apiKeyChecksumSecret()).toBe("default-secret");
    expect(apiKeyHashSalt()).toBe("default-salt");
    expect(spy).not.toHaveBeenCalled();
  });
});
