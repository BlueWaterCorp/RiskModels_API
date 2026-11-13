import { describe, expect, it } from "vitest";
import { FEED_SECRET_STASH_SCRIPT, readFeedSecret, sanitizeFeedSecrets, stripFeedSecrets } from "@/lib/feed-url-secrets";

const TOKEN = "3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f";

describe("feed link secrets never reach analytics", () => {
  it("strips token and inbox from feed URLs, keeping other parameters", () => {
    expect(stripFeedSecrets(`https://riskmodels.app/security-master-feed/unsubscribe?token=${TOKEN}`)).toBe(
      "https://riskmodels.app/security-master-feed/unsubscribe",
    );
    expect(
      stripFeedSecrets(`https://riskmodels.app/security-master-feed/delivery/confirm?token=abc&inbox=desk%40example.com#x`),
    ).toBe("https://riskmodels.app/security-master-feed/delivery/confirm#x");
    expect(stripFeedSecrets("https://riskmodels.app/security-master-feed?ref=9018ddd80c6a&token=abc")).toBe(
      "https://riskmodels.app/security-master-feed?ref=9018ddd80c6a",
    );
    // Other pages are untouched.
    expect(stripFeedSecrets("https://riskmodels.app/docs?token=keep")).toBe("https://riskmodels.app/docs?token=keep");
  });

  it("sanitises every string property of a PostHog event", () => {
    const ev = sanitizeFeedSecrets({
      properties: {
        $current_url: `https://riskmodels.app/security-master-feed/confirm?token=${TOKEN}`,
        $referrer: `https://riskmodels.app/security-master-feed/unsubscribe?token=${TOKEN}`,
        n: 1,
      },
      $set_once: { $initial_current_url: `https://riskmodels.app/security-master-feed/delivery?token=${TOKEN}` },
    });
    expect(JSON.stringify(ev)).not.toContain(TOKEN);
    expect(ev.properties!.n).toBe(1);
    expect(sanitizeFeedSecrets(null)).toBeNull();
  });

  it("the head script moves the secrets to sessionStorage and out of the address bar", () => {
    const store: Record<string, string> = {};
    let replaced: string | null = null;
    const fakeWindow = {
      location: { pathname: "/security-master-feed/unsubscribe", search: `?token=${TOKEN}&utm_source=x`, hash: "" },
    };
    const run = new Function("window", "sessionStorage", "history", "URLSearchParams", FEED_SECRET_STASH_SCRIPT);
    run(
      fakeWindow,
      { setItem: (k: string, v: string) => (store[k] = v) },
      { state: null, replaceState: (_s: unknown, _t: string, url: string) => (replaced = url) },
      URLSearchParams,
    );
    expect(replaced).toBe("/security-master-feed/unsubscribe?utm_source=x");
    expect(Object.values(store)).toEqual([TOKEN]);
  });

  it("keeps the page working when the browser blocks storage: the token stays in memory", () => {
    let replaced: string | null = null;
    const fakeWindow: Record<string, unknown> = {
      location: { pathname: "/security-master-feed/unsubscribe", search: `?token=${TOKEN}`, hash: "" },
    };
    const blocked = {
      setItem: () => {
        throw new Error("SecurityError");
      },
      getItem: () => {
        throw new Error("SecurityError");
      },
    };
    const run = new Function("window", "sessionStorage", "history", "URLSearchParams", FEED_SECRET_STASH_SCRIPT);
    run(fakeWindow, blocked, { state: null, replaceState: (_s: unknown, _t: string, url: string) => (replaced = url) }, URLSearchParams);
    expect(replaced).toBe("/security-master-feed/unsubscribe");
    // The page reads it back from memory even though storage throws and the URL no longer has it.
    (fakeWindow.location as { search: string }).search = "";
    const g = globalThis as unknown as { window?: unknown };
    const before = g.window;
    g.window = { ...fakeWindow, sessionStorage: blocked };
    try {
      expect(readFeedSecret("token")).toBe(TOKEN);
    } finally {
      g.window = before;
    }
  });
});
