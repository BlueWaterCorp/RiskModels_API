/**
 * Request screening and the private-feed credential flow.
 *
 * States these tests exist to catch:
 *  - a personal mailbox is refused outright, or a throwaway one is accepted;
 *  - a DNS failure on our side turns a real applicant away;
 *  - the access-link reply or its email differs by list state (pending, rejected, unknown);
 *  - a used, expired or unknown link still produces a credential;
 *  - a credential or link token reaches a log line, an analytics URL or an email.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { domainExists, emailDomain, isDisposableDomain, profileUrl, screenAddress } from "@/lib/feed-screen";

const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({ data: [] as unknown, error: null as unknown }));
const send = vi.fn();
const rateLimit = vi.fn();
const afterTasks: Array<() => Promise<void> | void> = [];
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => Promise<void> | void) => {
    afterTasks.push(task);
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/oauth/rate-limit", () => ({
  clientIp: () => "203.0.113.7",
  rateLimit: (...args: unknown[]) => rateLimit(...args),
}));
vi.mock("resend", () => ({ Resend: vi.fn().mockImplementation(() => ({ emails: { send } })) }));

import { POST as requestLink } from "@/app/api/feed-waitlist/access/request/route";
import { POST as issue } from "@/app/api/feed-waitlist/access/issue/route";
import { sendFeedEarlyAccessEmail } from "@/lib/feed-email";
import { FEED_KEY_RE, hashFeedKey } from "@/lib/feed-access";
import { sanitizeFeedSecrets, stripFeedSecrets } from "@/lib/feed-url-secrets";

const UNSUB = "3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f";
const post = (path: string, body: unknown) =>
  new NextRequest(`http://localhost/api/feed-waitlist/access/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
async function runAfter() {
  for (const task of afterTasks.splice(0)) await task();
}

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: [], error: null });
  send.mockReset().mockResolvedValue({ data: { id: "email-1" }, error: null });
  rateLimit.mockReset().mockResolvedValue({ ok: true, remaining: 9, retryAfter: 3600 });
  afterTasks.length = 0;
});

describe("address screen", () => {
  it("sorts by domain only: work, personal (manual review), throwaway (refused)", () => {
    expect(screenAddress("pm@examplecapital.com")).toBe("work");
    expect(screenAddress("j.smith@faculty.example.edu")).toBe("work");
    expect(screenAddress("someone@gmail.com")).toBe("personal");
    expect(screenAddress("Someone@Outlook.com")).toBe("personal");
    expect(screenAddress("x@mailinator.com")).toBe("disposable");
    expect(screenAddress("x@inbox.mailinator.com")).toBe("disposable");
    expect(isDisposableDomain("notmailinator.com")).toBe(false);
    expect(emailDomain("A@B@Example.COM.")).toBe("example.com");
  });

  it("gives the same answer whatever the name before the @ looks like", () => {
    for (const local of ["a", "xx99zz", "asdfghjkl", "no.reply.1234567", "ünïcode"]) {
      expect(screenAddress(`${local}@examplecapital.com`)).toBe("work");
      expect(screenAddress(`${local}@gmail.com`)).toBe("personal");
    }
  });

  const code = (c: string) => Object.assign(new Error(c), { code: c });

  it("treats a domain as missing only when DNS says it has neither mail nor address records", async () => {
    const none = { mx: async () => { throw code("ENOTFOUND"); }, address: async () => { throw code("ENOTFOUND"); } };
    expect(await domainExists("nope.example", none)).toBe(false);
    const empty = { mx: async () => [], address: async () => [] };
    expect(await domainExists("nope.example", empty)).toBe(false);
    const mx = { mx: async () => [{ exchange: "mx.example.com" }], address: async () => { throw code("ENOTFOUND"); } };
    expect(await domainExists("example.com", mx)).toBe(true);
    const aOnly = { mx: async () => { throw code("ENODATA"); }, address: async () => ["192.0.2.1"] };
    expect(await domainExists("example.com", aOnly)).toBe(true);
  });

  it("accepts the address when the lookup itself fails or is slow", async () => {
    const broken = { mx: async () => { throw code("ESERVFAIL"); }, address: async () => { throw code("ETIMEOUT"); } };
    expect(await domainExists("example.com", broken)).toBe(true);
    const mixed = { mx: async () => { throw code("ENOTFOUND"); }, address: async () => { throw code("ECONNREFUSED"); } };
    expect(await domainExists("example.com", mixed)).toBe(true);
    const slow = { mx: () => new Promise<unknown[]>(() => {}), address: async () => [] };
    expect(await domainExists("example.com", slow, 20)).toBe(true);
  });

  it("reads an optional firm website or profile link", () => {
    expect(profileUrl(undefined)).toBeNull();
    expect(profileUrl("  ")).toBeNull();
    expect(profileUrl("examplecapital.com/team")).toBe("https://examplecapital.com/team");
    expect(profileUrl("https://www.linkedin.com/in/someone")).toBe("https://www.linkedin.com/in/someone");
    for (const bad of ["javascript:alert(1)", "ftp://example.com", "https://user:pw@example.com", "localhost", "a b.com", 7, "x".repeat(400) + ".com"]) {
      expect(profileUrl(bad)).toBeUndefined();
    }
  });
});

describe("POST /api/feed-waitlist/access/request", () => {
  const claimed = { email: "pm@examplecapital.com", name: "P. M.", unsubscribe_token: UNSUB };

  it("answers every address with the same body, whether or not a link is sent", async () => {
    const replies: string[] = [];
    for (const data of [[claimed], [], []]) {
      rpc.mockResolvedValueOnce({ data, error: null });
      const res = await requestLink(post("request", { email: "pm@examplecapital.com" }));
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      replies.push(await res.text());
    }
    expect(new Set(replies).size).toBe(1);
  });

  it("emails a link only when the database claims one (approved, confirmed, subscribed), after the response", async () => {
    rpc.mockResolvedValue({ data: [claimed], error: null });
    await requestLink(post("request", { email: " PM@ExampleCapital.com " }));
    expect(send).not.toHaveBeenCalled();
    const [fn, args] = rpc.mock.calls[0]!;
    expect(fn).toBe("feed_access_claim_link");
    expect(args.p_email).toBe("pm@examplecapital.com");
    expect(args.p_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(args).toMatchObject({ p_min_interval_seconds: 300, p_max_sends: 5, p_window_seconds: 86400 });
    const ttl = new Date(args.p_expires_at as string).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(59 * 60_000);
    expect(ttl).toBeLessThanOrEqual(60 * 60_000);
    await runAfter();
    expect(send).toHaveBeenCalledTimes(1);
    const mail = send.mock.calls[0]![0];
    expect(mail.to).toBe("pm@examplecapital.com");
    // The link in the email hashes to what was stored; the stored value is not the link.
    const token = /access\/issue\?token=([A-Za-z0-9_-]{43})/.exec(mail.text)![1]!;
    expect(createHash("sha256").update(token).digest("hex")).toBe(args.p_token_hash);
    expect(mail.html).not.toContain(args.p_token_hash as string);
    // The email carries a link to a page, never a feed address or a credential.
    expect(mail.html + mail.text).not.toMatch(/rmf_|feed\.xml|key=/);
    expect(mail.headers["List-Unsubscribe"]).toContain(UNSUB);
  });

  it("sends nothing for a pending, rejected, revoked, unsubscribed, unknown or throttled address", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect((await requestLink(post("request", { email: "pending@examplecapital.com" }))).status).toBe(200);
    await runAfter();
    expect(afterTasks).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing and asks the database nothing for a filled honeypot or a malformed address", async () => {
    expect((await requestLink(post("request", { email: "pm@examplecapital.com", website: "x" }))).status).toBe(200);
    expect((await requestLink(post("request", { email: "not-an-address" }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("is rate limited, and logs neither the address nor the token on failure", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "bad row pm@examplecapital.com" } });
    expect((await requestLink(post("request", { email: "pm@examplecapital.com" }))).status).toBe(503);
    rpc.mockResolvedValue({ data: [claimed], error: null });
    send.mockRejectedValue(new Error("invalid to pm@examplecapital.com"));
    await requestLink(post("request", { email: "pm@examplecapital.com" }));
    await runAfter();
    const written = JSON.stringify(spy.mock.calls);
    expect(written).not.toContain("pm@examplecapital.com");
    expect(written).not.toMatch(/[A-Za-z0-9_-]{43}/);
    spy.mockRestore();
    rateLimit.mockResolvedValue({ ok: false, remaining: 0, retryAfter: 60 });
    expect((await requestLink(post("request", { email: "pm@examplecapital.com" }))).status).toBe(429);
  });
});

describe("POST /api/feed-waitlist/access/issue", () => {
  const LINK = "C".repeat(43);

  it("creates a credential for a valid link and stores only its hash", async () => {
    rpc.mockResolvedValue({ data: [{ contact_id: "c-1" }], error: null });
    const res = await issue(post("issue", { token: LINK }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    const body = await res.json();
    expect(body.key).toMatch(FEED_KEY_RE);
    expect(body.rss_url).toBe(`https://riskmodels.app/security-master-feed/private/feed.xml?key=${body.key}`);
    expect(body.json_url).toBe(`https://riskmodels.app/security-master-feed/private/latest.json?key=${body.key}`);
    const [fn, args] = rpc.mock.calls[0]!;
    expect(fn).toBe("feed_access_issue");
    expect(args).toEqual({
      p_link_token_hash: createHash("sha256").update(LINK).digest("hex"),
      p_new_token_hash: hashFeedKey(body.key),
    });
    expect(JSON.stringify(args)).not.toContain(body.key);
  });

  it("gives a different credential each time", async () => {
    rpc.mockResolvedValue({ data: [{ contact_id: "c-1" }], error: null });
    const a = await (await issue(post("issue", { token: LINK }))).json();
    const b = await (await issue(post("issue", { token: LINK }))).json();
    expect(a.key).not.toBe(b.key);
  });

  it("returns no credential when the database matches nothing (used, expired, unknown, no longer approved)", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const res = await issue(post("issue", { token: LINK }));
    expect(res.status).toBe(400);
    expect(await res.text()).not.toMatch(/rmf_/);
  });

  it("refuses a malformed token, an unsubscribe token or a feed credential without asking the database", async () => {
    for (const token of ["", "short", UNSUB, "rmf_" + "A".repeat(43), 12, null]) {
      expect((await issue(post("issue", { token }))).status).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers 503 without a credential on a database error, and logs no token", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: `bad ${LINK}` } });
    const res = await issue(post("issue", { token: LINK }));
    expect(res.status).toBe(503);
    expect(await res.text()).not.toMatch(/rmf_/);
    expect(JSON.stringify(spy.mock.calls)).not.toContain(LINK);
    spy.mockRestore();
  });
});

describe("welcome email after confirming", () => {
  const row = { email: "pm@examplecapital.com", name: "P. M.", consent_feed_emails: true, unsubscribe_token: UNSUB, unsubscribed_at: null };

  it("tells a contact still under review that nothing is delivered yet", async () => {
    await sendFeedEarlyAccessEmail({ ...row, approved: false });
    const mail = send.mock.calls[0]![0];
    expect(mail.text).toMatch(/review/i);
    expect(mail.text).not.toMatch(/security-master-feed\/access/);
  });

  it("points an approved contact to the private-feed page", async () => {
    await sendFeedEarlyAccessEmail({ ...row, approved: true });
    const mail = send.mock.calls[0]![0];
    expect(mail.text).toContain("https://riskmodels.app/security-master-feed/access");
    expect(mail.html + mail.text).not.toMatch(/rmf_|key=/);
  });
});

describe("feed credentials never reach analytics", () => {
  const KEY = "rmf_" + "k".repeat(43);
  it("strips ?key= from feed page URLs along with the other link secrets", () => {
    expect(stripFeedSecrets(`https://riskmodels.app/security-master-feed/access/issue?token=abc&key=${KEY}&x=1`)).toBe(
      "https://riskmodels.app/security-master-feed/access/issue?x=1",
    );
    const ev = sanitizeFeedSecrets({
      properties: { $current_url: `https://riskmodels.app/security-master-feed/private/feed.xml?key=${KEY}` },
    });
    expect(JSON.stringify(ev)).not.toContain(KEY);
  });
});
