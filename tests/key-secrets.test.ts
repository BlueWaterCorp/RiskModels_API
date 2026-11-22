import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  KeySecretConfigError,
  apiKeyChecksumSecret,
  apiKeyHashSalt,
} from "@/lib/agent/key-secrets";
import { generateApiKey, hashApiKey, isValidApiKeyFormat, validateApiKey } from "@/lib/agent/api-keys";
import { generateUserApiKey, hashApiKey as hashUserKey } from "@/lib/user-api-keys";

describe("API key secrets", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("production with the variables unset", () => {
    beforeEach(() => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("API_KEY_SECRET", "");
      vi.stubEnv("API_KEY_SALT", "");
    });

    it("refuses to produce a checksum secret or salt", () => {
      expect(() => apiKeyChecksumSecret()).toThrow(KeySecretConfigError);
      expect(() => apiKeyHashSalt()).toThrow(KeySecretConfigError);
    });

    it("refuses to issue, hash or format-check keys instead of using a default", () => {
      expect(() => generateApiKey("live")).toThrow(/API_KEY_SECRET is not set/);
      expect(() => hashApiKey("rm_agent_live_x_y")).toThrow(KeySecretConfigError);
      expect(() => isValidApiKeyFormat("rm_agent_live_abc_12345678")).toThrow(KeySecretConfigError);
      expect(() => generateUserApiKey("live")).toThrow(KeySecretConfigError);
      expect(() => hashUserKey("rm_user_live_x_y")).toThrow(KeySecretConfigError);
    });

    it("validateApiKey reports a server fault, not an invalid key", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const r = await validateApiKey(`rm_agent_live_${"a".repeat(32)}_${"b".repeat(8)}`);
      expect(r.valid).toBe(false);
      expect(r.serverError).toBe(true);
      expect(r.error).toMatch(/SERVER_CONFIG_ERROR/);
      spy.mockRestore();
    });

    it("whitespace-only values count as unset", () => {
      vi.stubEnv("API_KEY_SECRET", "   ");
      expect(() => apiKeyChecksumSecret()).toThrow(KeySecretConfigError);
    });
  });

  describe("production with the variables set", () => {
    beforeEach(() => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("API_KEY_SECRET", "prod-secret-value");
    });

    it("uses API_KEY_SECRET for both when API_KEY_SALT is unset", () => {
      vi.stubEnv("API_KEY_SALT", "");
      expect(apiKeyChecksumSecret()).toBe("prod-secret-value");
      expect(apiKeyHashSalt()).toBe("prod-secret-value");
    });

    it("prefers API_KEY_SALT for the hash", () => {
      vi.stubEnv("API_KEY_SALT", "prod-salt-value");
      expect(apiKeyHashSalt()).toBe("prod-salt-value");
      const { plainKey } = generateApiKey("live");
      expect(isValidApiKeyFormat(plainKey)).toBe(true);
    });
  });

  describe("local dev and tests", () => {
    it("keeps the old defaults so nothing needs configuring", () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("API_KEY_SECRET", "");
      vi.stubEnv("API_KEY_SALT", "");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(apiKeyChecksumSecret()).toBe("default-secret");
      expect(apiKeyHashSalt()).toBe("default-salt");
      const { plainKey } = generateApiKey("live");
      expect(isValidApiKeyFormat(plainKey)).toBe(true);
      warn.mockRestore();
    });

    it("hashes exactly as before the change (stored hashes stay valid)", async () => {
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("API_KEY_SECRET", "s3cret");
      vi.stubEnv("API_KEY_SALT", "");
      const { createHash } = await import("crypto");
      const expected = createHash("sha256").update("rm_agent_live_abc" + "s3cret").digest("hex");
      expect(hashApiKey("rm_agent_live_abc")).toBe(expected);
      expect(hashUserKey("rm_agent_live_abc")).toBe(expected);
    });
  });
});
