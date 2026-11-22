import { describe, expect, it } from "vitest";
import { createFakeDb } from "./fixtures/fake-supabase";
import {
  FIRST_KEY_NAME,
  STALE_PLACEHOLDER_MS,
  firstKeyPlaceholderHash,
  isFirstKeyPlaceholder,
  issueFirstKeyIfNone,
} from "@/lib/agent/first-key";
import { hashApiKey, isValidApiKeyFormat } from "@/lib/agent/api-keys";

/** agent_api_keys.key_hash is UNIQUE in the real schema; the guard relies on it. */
const db = () => createFakeDb({ unique: { agent_api_keys: ["key_hash"] } });
const USER = "11111111-1111-4111-8111-111111111111";

const realKeys = (d: ReturnType<typeof db>) =>
  d.table("agent_api_keys").filter((r) => !isFirstKeyPlaceholder(r));

describe("issueFirstKeyIfNone", () => {
  it("issues one valid key for a user with none and leaves no placeholder", async () => {
    const d = db();
    const r = await issueFirstKeyIfNone(d, USER);
    expect(r.issued).toBe(true);
    if (!r.issued) return;
    expect(r.key.name).toBe(FIRST_KEY_NAME);
    expect(isValidApiKeyFormat(r.key.plainKey)).toBe(true);
    const rows = d.table("agent_api_keys");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.key_hash).toBe(hashApiKey(r.key.plainKey));
    expect(rows[0]!.revoked_at ?? null).toBeNull();
    // Plaintext is returned, never stored.
    expect(JSON.stringify(rows)).not.toContain(r.key.plainKey);
  });

  it("a reload (second call) creates no second key and returns no plaintext", async () => {
    const d = db();
    const first = await issueFirstKeyIfNone(d, USER);
    const second = await issueFirstKeyIfNone(d, USER);
    const third = await issueFirstKeyIfNone(d, USER);
    expect(first.issued).toBe(true);
    expect(second).toEqual({ issued: false, reason: "has_key" });
    expect(third).toEqual({ issued: false, reason: "has_key" });
    expect(realKeys(d)).toHaveLength(1);
  });

  it("two tabs at once: exactly one key, exactly one caller gets the plaintext", async () => {
    for (let round = 0; round < 25; round++) {
      const d = db();
      const results = await Promise.all([
        issueFirstKeyIfNone(d, USER),
        issueFirstKeyIfNone(d, USER),
        issueFirstKeyIfNone(d, USER),
      ]);
      expect(results.filter((r) => r.issued)).toHaveLength(1);
      expect(realKeys(d)).toHaveLength(1);
      expect(d.table("agent_api_keys")).toHaveLength(1); // placeholder gone
    }
  });

  it("does nothing for a user who already has a key, including a revoked one", async () => {
    const d = db();
    d.table("agent_api_keys").push({
      id: "k1", user_id: USER, key_hash: "h1", key_prefix: "rm_agent_live_ab", revoked_at: "2026-01-01T00:00:00.000Z",
    });
    expect(await issueFirstKeyIfNone(d, USER)).toEqual({ issued: false, reason: "has_key" });
    expect(d.table("agent_api_keys")).toHaveLength(1);
  });

  it("another user's keys do not count", async () => {
    const d = db();
    d.table("agent_api_keys").push({ id: "k1", user_id: "someone-else", key_hash: "h1", key_prefix: "rm_agent_live_ab" });
    expect((await issueFirstKeyIfNone(d, USER)).issued).toBe(true);
  });

  it("reports in_progress while another request holds the placeholder", async () => {
    const d = db();
    d.table("agent_api_keys").push({
      id: "p1", user_id: USER, key_hash: firstKeyPlaceholderHash(USER), key_prefix: "pending",
      created_at: new Date().toISOString(), revoked_at: new Date().toISOString(),
    });
    expect(await issueFirstKeyIfNone(d, USER)).toEqual({ issued: false, reason: "in_progress" });
    expect(realKeys(d)).toHaveLength(0);
  });

  it("clears a placeholder left by a crashed request and issues", async () => {
    const d = db();
    const now = Date.now();
    d.table("agent_api_keys").push({
      id: "p1", user_id: USER, key_hash: firstKeyPlaceholderHash(USER), key_prefix: "pending",
      created_at: new Date(now - STALE_PLACEHOLDER_MS - 1000).toISOString(), revoked_at: new Date(now).toISOString(),
    });
    const r = await issueFirstKeyIfNone(d, USER, { now });
    expect(r.issued).toBe(true);
    expect(d.table("agent_api_keys")).toHaveLength(1);
  });

  it("fails closed (no key) when the key count cannot be read", async () => {
    const d = createFakeDb({ failing: { agent_api_keys: { message: "db down" } } });
    expect(await issueFirstKeyIfNone(d, USER)).toEqual({ issued: false, reason: "error" });
  });

  it("the placeholder row can never be a valid credential", () => {
    const hash = firstKeyPlaceholderHash(USER);
    expect(isValidApiKeyFormat(hash)).toBe(false);
    expect(hashApiKey(hash)).not.toBe(hash);
    expect(isFirstKeyPlaceholder({ key_prefix: "pending" })).toBe(true);
    expect(isFirstKeyPlaceholder({ key_prefix: "rm_agent_live_ab" })).toBe(false);
  });
});
