import { createHash } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetKeySecretReport,
  apiKeyChecksumSecrets,
  apiKeyHashCandidates,
} from "@/lib/agent/key-secrets";
import { generateApiKey, isValidApiKeyFormat } from "@/lib/agent/api-keys";
import { keyAllowsCapability } from "@/lib/agent/key-scopes";

const sha = (key: string, salt: string) => createHash("sha256").update(key + salt).digest("hex");

describe("key rotation (RMAPI-32)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    __resetKeySecretReport();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("with nothing configured, looks up the default hash only", () => {
    vi.stubEnv("API_KEY_SECRET", "");
    vi.stubEnv("API_KEY_SALT", "");
    expect(apiKeyHashCandidates("k")).toEqual([sha("k", "default-salt")]);
    expect(apiKeyChecksumSecrets()).toEqual(["default-secret"]);
  });

  it("with a new salt, looks up the new hash first and the default second", () => {
    vi.stubEnv("API_KEY_SECRET", "new-secret");
    vi.stubEnv("API_KEY_SALT", "new-salt");
    expect(apiKeyHashCandidates("k")).toEqual([sha("k", "new-salt"), sha("k", "default-salt")]);
  });

  it("closing the window drops the default", () => {
    vi.stubEnv("API_KEY_SECRET", "new-secret");
    vi.stubEnv("API_KEY_SALT", "new-salt");
    vi.stubEnv("API_KEY_ACCEPT_LEGACY", "off");
    expect(apiKeyHashCandidates("k")).toEqual([sha("k", "new-salt")]);
    expect(apiKeyChecksumSecrets()).toEqual(["new-secret"]);
  });

  it("a key issued before rotation passes the format check after it, until the window closes", () => {
    vi.stubEnv("API_KEY_SECRET", "");
    vi.stubEnv("API_KEY_SALT", "");
    const { plainKey } = generateApiKey("live");
    vi.stubEnv("API_KEY_SECRET", "new-secret");
    vi.stubEnv("API_KEY_SALT", "new-salt");
    expect(isValidApiKeyFormat(plainKey)).toBe(true);
    vi.stubEnv("API_KEY_ACCEPT_LEGACY", "off");
    expect(isValidApiKeyFormat(plainKey)).toBe(false);
  });

  it("a key issued after rotation passes the format check", () => {
    vi.stubEnv("API_KEY_SECRET", "new-secret");
    vi.stubEnv("API_KEY_SALT", "new-salt");
    const { plainKey, hashedKey } = generateApiKey("live");
    expect(isValidApiKeyFormat(plainKey)).toBe(true);
    expect(hashedKey).toBe(sha(plainKey, "new-salt"));
  });
});

describe("key scopes (BWM-19)", () => {
  const isCap = (id: string) => ["ticker-returns", "l3-decomposition", "batch-analyze", "metrics"].includes(id);

  it("no scopes, * and read grant every capability", () => {
    for (const s of [null, [], ["*"], ["read"]]) expect(keyAllowsCapability(s, "metrics", isCap)).toBe(true);
  });

  it("a list of capability ids grants only those", () => {
    const s = ["ticker-returns", "l3-decomposition", "batch-analyze"];
    expect(keyAllowsCapability(s, "l3-decomposition", isCap)).toBe(true);
    expect(keyAllowsCapability(s, "metrics", isCap)).toBe(false);
  });

  it("modifiers alone do not narrow access", () => {
    expect(keyAllowsCapability(["rate:120"], "metrics", isCap)).toBe(true);
    expect(keyAllowsCapability(["plaid:holdings", "mcp:read"], "metrics", isCap)).toBe(true);
    expect(keyAllowsCapability(["rate:120", "ticker-returns"], "metrics", isCap)).toBe(false);
  });
});
