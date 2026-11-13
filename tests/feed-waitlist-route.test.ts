import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";

const upsert = vi.fn(async (_row: Record<string, unknown>, _opts?: Record<string, unknown>) => ({
  error: null as unknown,
}));
const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({
  data: [] as unknown,
  error: null as unknown,
}));
// Referral lookup: from("feed_waitlist").select("id").eq("referral_code", code).maybeSingle()
const referralLookup = vi.fn(async (_code: string) => ({ data: null as unknown, error: null as unknown }));
const select = vi.fn((_cols: string) => ({
  eq: (_col: string, code: string) => ({ maybeSingle: () => referralLookup(code) }),
}));
const from = vi.fn(() => ({ upsert, select }));
const sendFeedConfirmation = vi.fn();
const getUser = vi.fn();
const rateLimit = vi.fn();
const afterTasks: Array<() => Promise<void> | void> = [];

// Route handlers queue the email with after(); the tests run those tasks explicitly.
vi.mock("next/server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("next/server")>();
  return {
    ...mod,
    after: (task: () => Promise<void> | void) => {
      afterTasks.push(task);
    },
  };
});
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from, rpc }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));
vi.mock("@/lib/feed-email", () => ({
  sendFeedConfirmation: (...args: unknown[]) => sendFeedConfirmation(...args),
}));
vi.mock("@/lib/oauth/rate-limit", () => ({
  clientIp: () => "203.0.113.7",
  rateLimit: (...args: unknown[]) => rateLimit(...args),
}));

import { POST } from "@/app/api/feed-waitlist/route";

const URL = "http://localhost/api/feed-waitlist";
const TOKEN_HASH_RE = /^[0-9a-f]{64}$/;

/** The form's required terms box is ticked unless a test says otherwise. */
function request(body: unknown): NextRequest {
  const withTerms =
    body && typeof body === "object" && !Array.isArray(body) && !("terms_accepted" in body)
      ? { ...(body as Record<string, unknown>), terms_accepted: true }
      : body;
  return new NextRequest(URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof withTerms === "string" ? withTerms : JSON.stringify(withTerms),
  });
}

async function runAfter() {
  for (const task of afterTasks.splice(0)) await task();
}

const claimedRow = (over: Record<string, unknown> = {}) => ({
  id: "row-1",
  email: "new@example.com",
  name: "N. Ew",
  unsubscribe_token: "3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f",
  ...over,
});

describe("POST /api/feed-waitlist", () => {
  beforeEach(() => {
    upsert.mockReset().mockResolvedValue({ error: null });
    rpc.mockReset().mockResolvedValue({ data: [], error: null });
    from.mockClear();
    select.mockClear();
    referralLookup.mockReset().mockResolvedValue({ data: null, error: null });
    sendFeedConfirmation.mockReset().mockResolvedValue({ id: "email-1" });
    afterTasks.length = 0;
    getUser.mockReset().mockResolvedValue({ data: { user: null } });
    rateLimit.mockReset().mockResolvedValue({ ok: true, remaining: 9, retryAfter: 3600 });
  });

  describe("double opt-in: the signup never records consent", () => {
    it("stores a new row WITHOUT consent even when the box is ticked", async () => {
      const res = await POST(
        request({
          email: "  Analyst@Example.COM ",
          name: "A. Analyst",
          company: "Example Capital",
          role: "PM",
          intended_use: "risk_portfolio",
          consent_feed_emails: true,
        }),
      );
      expect(res.status).toBe(200);
      expect(from).toHaveBeenCalledWith("feed_waitlist");
      const [row, opts] = upsert.mock.calls[0]!;
      expect(row).toMatchObject({
        email: "analyst@example.com",
        name: "A. Analyst",
        company: "Example Capital",
        role: "PM",
        intended_use: "risk_portfolio",
        consent_feed_emails: false,
        consented_at: null,
        user_id: null,
        source: "security-master-feed",
      });
      expect(opts).toEqual({ onConflict: "email", ignoreDuplicates: true });
    });

    it("asks for a confirmation email through the atomic claim, with a hashed single-use token", async () => {
      rpc.mockResolvedValue({ data: [claimedRow()], error: null });
      const res = await POST(request({ email: "new@example.com", consent_feed_emails: true }));
      expect(res.status).toBe(200);
      expect((await res.json()).message).toMatch(/Check your email/);
      expect(rpc).toHaveBeenCalledTimes(1);
      const [fn, args] = rpc.mock.calls[0]!;
      expect(fn).toBe("feed_waitlist_claim_confirmation");
      expect(args).toMatchObject({
        p_email: "new@example.com",
        p_min_interval_seconds: 900,
        p_max_sends: 3,
        p_window_seconds: 86400, // rolling window: an owner is never locked out for good
      });
      expect(args.p_token_hash).toMatch(TOKEN_HASH_RE);
      expect(new Date(args.p_expires_at as string).getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000);

      await runAfter();
      expect(sendFeedConfirmation).toHaveBeenCalledTimes(1);
      const [row, token] = sendFeedConfirmation.mock.calls[0]!;
      expect(row).toMatchObject({ email: "new@example.com" });
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      // The database holds only the hash of the token that went into the email.
      expect(createHash("sha256").update(token).digest("hex")).toBe(args.p_token_hash);
    });

    it("sends nothing and claims nothing when the box is not ticked", async () => {
      const res = await POST(request({ email: "a@example.com" }));
      expect(res.status).toBe(200);
      expect((await res.json()).message).toMatch(/will not email you/);
      expect(rpc).not.toHaveBeenCalled();
      expect(afterTasks).toHaveLength(0);
    });

    it("sends nothing when the claim matches no row (consented, unsubscribed, throttled or capped)", async () => {
      rpc.mockResolvedValue({ data: [], error: null });
      const res = await POST(request({ email: "listed@example.com", consent_feed_emails: true }));
      expect(res.status).toBe(200);
      expect(afterTasks).toHaveLength(0);
      await runAfter();
      expect(sendFeedConfirmation).not.toHaveBeenCalled();
    });

    it("returns the same reply whether or not the address was already listed", async () => {
      rpc.mockResolvedValue({ data: [claimedRow()], error: null });
      const first = await POST(request({ email: "x@example.com", consent_feed_emails: true }));
      rpc.mockResolvedValue({ data: [], error: null });
      const repeat = await POST(request({ email: "x@example.com", consent_feed_emails: true }));
      expect(repeat.status).toBe(first.status);
      expect(await repeat.json()).toEqual(await first.json());
      expect([...repeat.headers.entries()].sort()).toEqual([...first.headers.entries()].sort());
    });

    it("does not wait for the email provider (so latency cannot reveal list state)", async () => {
      rpc.mockResolvedValue({ data: [claimedRow()], error: null });
      sendFeedConfirmation.mockImplementation(() => new Promise(() => {})); // never settles
      const res = await POST(request({ email: "new@example.com", consent_feed_emails: true }));
      expect(res.status).toBe(200);
      expect(sendFeedConfirmation).not.toHaveBeenCalled(); // queued, not yet run, not awaited
      expect(afterTasks).toHaveLength(1);
    });

    it("never changes an existing row's fields (the upsert ignores duplicates)", async () => {
      await POST(request({ email: "old@example.com", name: "Attacker", consent_feed_emails: true }));
      expect(upsert.mock.calls[0]![1]).toMatchObject({ ignoreDuplicates: true });
      expect(from).toHaveBeenCalledTimes(1); // the only table call is the insert-if-absent
    });

    it("attaches the session user id to a new row", async () => {
      getUser.mockResolvedValue({ data: { user: { id: "user-123" } } });
      await POST(request({ email: "a@example.com" }));
      expect(upsert.mock.calls[0]![0]).toMatchObject({ user_id: "user-123", consent_feed_emails: false });
    });
  });

  describe("two addresses: a contact and a separate feed delivery address", () => {
    it("stores the delivery address as a REQUEST on the new contact row, not as a row or a link", async () => {
      rpc.mockResolvedValue({ data: [claimedRow()], error: null });
      await POST(request({ email: "Analyst@Corp.com", feed_email: "  OPS@Corp.com ", consent_feed_emails: true }));
      expect(upsert).toHaveBeenCalledTimes(1); // only the contact row is written at signup
      expect(upsert.mock.calls[0]![0]).toMatchObject({
        email: "analyst@corp.com",
        requested_feed_email: "ops@corp.com",
        consent_feed_emails: false,
      });
    });

    it("asks only the contact to confirm at signup, and names the delivery address in that email", async () => {
      rpc.mockResolvedValue({ data: [claimedRow({ email: "analyst@corp.com", requested_feed_email: "ops@corp.com" })], error: null });
      const res = await POST(request({ email: "analyst@corp.com", feed_email: "ops@corp.com", consent_feed_emails: true }));
      expect((await res.json()).message).toMatch(/ask the feed delivery address to confirm too/);
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc.mock.calls[0]![1]).toMatchObject({ p_email: "analyst@corp.com" });
      await runAfter();
      expect(sendFeedConfirmation).toHaveBeenCalledTimes(1);
      expect(sendFeedConfirmation.mock.calls[0]![0]).toMatchObject({ email: "analyst@corp.com" });
      expect(sendFeedConfirmation.mock.calls[0]![2]).toEqual({ requestedFeedEmail: "ops@corp.com", marketingOptIn: false });
    });

    it("names the STORED delivery address even when a repeat signup omits it, so the warning cannot be hidden", async () => {
      // The row was registered earlier with the attacker's address; this request carries no feed_email.
      rpc.mockResolvedValue({ data: [claimedRow({ email: "victim@corp.com", requested_feed_email: "attacker@evil.com" })], error: null });
      await POST(request({ email: "victim@corp.com", consent_feed_emails: true }));
      await runAfter();
      expect(sendFeedConfirmation.mock.calls[0]![2]).toEqual({ requestedFeedEmail: "attacker@evil.com", marketingOptIn: false });
    });

    it("names the stored address, not a different one submitted by a repeat signup", async () => {
      rpc.mockResolvedValue({ data: [claimedRow({ email: "victim@corp.com", requested_feed_email: "attacker@evil.com" })], error: null });
      await POST(request({ email: "victim@corp.com", feed_email: "friendly@corp.com", consent_feed_emails: true }));
      await runAfter();
      expect(sendFeedConfirmation.mock.calls[0]![2]).toEqual({ requestedFeedEmail: "attacker@evil.com", marketingOptIn: false });
    });

    it("names no delivery address when none is stored, even if this request submitted one", async () => {
      rpc.mockResolvedValue({ data: [claimedRow({ requested_feed_email: null })], error: null });
      await POST(request({ email: "new@example.com", feed_email: "ops@corp.com", consent_feed_emails: true }));
      await runAfter();
      expect(sendFeedConfirmation.mock.calls[0]![2]).toEqual({ requestedFeedEmail: null, marketingOptIn: false });
    });

    it("treats a delivery address equal to the contact address as one address", async () => {
      await POST(request({ email: "a@corp.com", feed_email: "A@Corp.com", consent_feed_emails: true }));
      expect(upsert.mock.calls[0]![0]).toMatchObject({ requested_feed_email: null });
    });

    it("stores no delivery request when the box is not ticked", async () => {
      await POST(request({ email: "a@corp.com", feed_email: "ops@corp.com" }));
      expect(upsert.mock.calls[0]![0]).toMatchObject({ requested_feed_email: null });
      expect(rpc).not.toHaveBeenCalled();
    });

    it("rejects a malformed delivery address, and writes nothing", async () => {
      const res = await POST(request({ email: "a@corp.com", feed_email: "not-an-email", consent_feed_emails: true }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Invalid feed_email");
      expect(upsert).not.toHaveBeenCalled();
    });

    it("gives the same reply for a listed and a new contact when a delivery address is given", async () => {
      rpc.mockResolvedValue({ data: [claimedRow()], error: null });
      const first = await POST(request({ email: "x@corp.com", feed_email: "ops@corp.com", consent_feed_emails: true }));
      rpc.mockResolvedValue({ data: [], error: null });
      const repeat = await POST(request({ email: "x@corp.com", feed_email: "ops@corp.com", consent_feed_emails: true }));
      expect(await repeat.json()).toEqual(await first.json());
    });

    it("never creates the delivery address row or a link from the signup (only a confirmed contact can)", async () => {
      await POST(request({ email: "a@corp.com", feed_email: "ops@corp.com", consent_feed_emails: true }));
      expect(from).toHaveBeenCalledTimes(1);
      expect(rpc.mock.calls.every(([fn]) => fn === "feed_waitlist_claim_confirmation")).toBe(true);
    });
  });

  describe("terms, profile, marketing opt-in and referrals", () => {
    it("refuses a signup without the terms box, and writes nothing", async () => {
      for (const terms_accepted of [false, undefined, "yes"]) {
        const res = await POST(request({ email: "a@example.com", consent_feed_emails: true, terms_accepted }));
        expect(res.status).toBe(400);
      }
      expect(upsert).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    });

    it("never writes terms, marketing or referral on the row: they ride on this submission's claim", async () => {
      referralLookup.mockResolvedValue({ data: { id: "referrer-row" }, error: null });
      await POST(request({ email: "a@example.com", consent_feed_emails: true, marketing_opt_in: true, ref: "9018ddd80c6a" }));
      const [row] = upsert.mock.calls[0]!;
      for (const k of ["terms_version", "terms_accepted_at", "marketing_opt_in", "marketing_opt_in_at", "referred_by", "deliver_to_contact"]) {
        expect(row).not.toHaveProperty(k);
      }
      const [fn, args] = rpc.mock.calls[0]!;
      expect(fn).toBe("feed_waitlist_claim_confirmation");
      expect(args).toMatchObject({
        p_from_submission: true,
        p_terms_version: "2026-11-13",
        p_marketing_opt_in: true,
        p_referred_by: "referrer-row",
      });
    });

    it("attack sequence: a stranger's values are only pending; the owner's own submission replaces them, and the email states the choice", async () => {
      // 1. A third party submits the victim's address with marketing ticked and their own referral code.
      referralLookup.mockResolvedValue({ data: { id: "stranger-row" }, error: null });
      rpc.mockResolvedValueOnce({ data: [claimedRow({ email: "victim@example.com", marketing_opt_in: true })], error: null });
      await POST(request({ email: "victim@example.com", consent_feed_emails: true, marketing_opt_in: true, ref: "0000aaaa1111" }));
      expect(upsert.mock.calls[0]![0]).not.toHaveProperty("marketing_opt_in");
      expect(rpc.mock.calls[0]![1]).toMatchObject({ p_from_submission: true, p_marketing_opt_in: true, p_referred_by: "stranger-row" });
      await runAfter();
      // The email the victim receives says confirming would turn marketing on.
      expect(sendFeedConfirmation.mock.calls[0]![2]).toMatchObject({ marketingOptIn: true });
      // 2. The victim signs up themself, without marketing or a referral: their claim carries their own values.
      referralLookup.mockResolvedValue({ data: null, error: null });
      rpc.mockResolvedValueOnce({ data: [claimedRow({ email: "victim@example.com", marketing_opt_in: false })], error: null });
      await POST(request({ email: "victim@example.com", consent_feed_emails: true }));
      expect(rpc.mock.calls[1]![1]).toMatchObject({ p_from_submission: true, p_marketing_opt_in: false, p_referred_by: null });
      await runAfter();
      expect(sendFeedConfirmation.mock.calls[1]![2]).toMatchObject({ marketingOptIn: false });
      // Nothing consent-like was ever written by either request (the database test covers the confirm step).
      for (const [row] of upsert.mock.calls) expect(row).not.toHaveProperty("referred_by");
    });

    it("records no terms, marketing or referral when no confirmation email is asked for", async () => {
      await POST(request({ email: "a@example.com", marketing_opt_in: true, ref: "9018ddd80c6a" }));
      expect(rpc).not.toHaveBeenCalled();
      expect(upsert.mock.calls[0]![0]).not.toHaveProperty("marketing_opt_in");
    });

    it("stores the optional profile answers", async () => {
      await POST(
        request({
          email: "a@example.com",
          company: "Example Capital",
          firm_type: "hedge_fund",
          firm_size: "1b_10b",
          uses: ["reconciliation", "compliance", "reconciliation"],
          audience: "automated",
          heard_about: "A colleague",
        }),
      );
      const [row] = upsert.mock.calls[0]!;
      expect(row).toMatchObject({
        company: "Example Capital",
        firm_type: "hedge_fund",
        firm_size: "1b_10b",
        uses: ["reconciliation", "compliance"],
        audience: "automated",
        heard_about: "A colleague",
      });
    });

    it("leaves every profile answer empty when none is given", async () => {
      await POST(request({ email: "a@example.com" }));
      const [row] = upsert.mock.calls[0]!;
      expect(row).toMatchObject({ firm_type: null, firm_size: null, uses: [], audience: null, heard_about: null });
    });

    it("rejects profile values that are not on the lists", async () => {
      for (const extra of [
        { firm_type: "family_office" },
        { firm_size: "huge" },
        { audience: "everyone" },
        { uses: ["reconciliation", "nope"] },
        { uses: "reconciliation" },
      ]) {
        const res = await POST(request({ email: "a@example.com", ...extra }));
        expect(res.status).toBe(400);
      }
      expect(upsert).not.toHaveBeenCalled();
    });

    it("passes the referrer of a known code to the claim, and ignores an unknown or malformed one", async () => {
      referralLookup.mockResolvedValue({ data: { id: "referrer-row" }, error: null });
      await POST(request({ email: "a@example.com", consent_feed_emails: true, ref: "9018ddd80c6a" }));
      expect(referralLookup).toHaveBeenCalledWith("9018ddd80c6a");
      expect(rpc.mock.calls[0]![1].p_referred_by).toBe("referrer-row");
      referralLookup.mockResolvedValue({ data: null, error: null });
      const ok = await POST(request({ email: "b@example.com", consent_feed_emails: true, ref: "0000aaaa1111" }));
      expect(ok.status).toBe(200);
      expect(rpc.mock.calls[1]![1].p_referred_by).toBeNull();
      await POST(request({ email: "c@example.com", consent_feed_emails: true, ref: "x'); drop" }));
      expect(referralLookup).toHaveBeenCalledTimes(2);
      expect(rpc.mock.calls[2]![1].p_referred_by).toBeNull();
    });

    it("keeps a referral lookup error out of the reply and the logs", async () => {
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      referralLookup.mockResolvedValue({ data: null, error: { message: "row a@example.com" } });
      const res = await POST(request({ email: "a@example.com", ref: "9018ddd80c6a" }));
      expect(res.status).toBe(200);
      expect(JSON.stringify(err.mock.calls)).not.toContain("a@example.com");
      err.mockRestore();
    });

  });

  describe("validation and abuse controls", () => {
    it("rejects a missing or malformed email", async () => {
      expect((await POST(request({}))).status).toBe(400);
      expect((await POST(request({ email: "not-an-email" }))).status).toBe(400);
      expect(upsert).not.toHaveBeenCalled();
    });

    it("rejects an unknown intended_use", async () => {
      const res = await POST(request({ email: "a@example.com", intended_use: "trading" }));
      expect(res.status).toBe(400);
      expect(upsert).not.toHaveBeenCalled();
    });

    it("rejects invalid JSON", async () => {
      expect((await POST(request("{nope"))).status).toBe(400);
    });

    it("returns success without writing when the honeypot is filled", async () => {
      const res = await POST(request({ email: "bot@example.com", website: "http://spam", consent_feed_emails: true }));
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
      expect(upsert).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    });

    it("returns 429 when the IP is over the limit", async () => {
      rateLimit.mockResolvedValue({ ok: false, remaining: 0, retryAfter: 1200 });
      const res = await POST(request({ email: "a@example.com" }));
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("1200");
      expect(rateLimit).toHaveBeenCalledWith("feed-waitlist", "203.0.113.7", 10, 3600);
      expect(upsert).not.toHaveBeenCalled();
    });

    it("returns 503 when the store write fails", async () => {
      upsert.mockResolvedValue({ error: { code: "42P01", message: 'relation "feed_waitlist" does not exist' } });
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      expect((await POST(request({ email: "a@example.com" }))).status).toBe(503);
      errSpy.mockRestore();
    });

    it("returns 503 when the confirmation claim fails", async () => {
      rpc.mockResolvedValue({ data: null, error: { code: "42883", message: "function does not exist" } });
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await POST(request({ email: "a@example.com", consent_feed_emails: true }));
      expect(res.status).toBe(503);
      expect(afterTasks).toHaveLength(0);
      errSpy.mockRestore();
    });
  });

  describe("logs carry no email addresses or tokens", () => {
    const SENTINEL_EMAIL = "sentinel.leak@example.com";
    const SENTINEL_TOKEN = "deadbeef-dead-4bee-8eef-deadbeefdead";
    const logged = (spy: ReturnType<typeof vi.spyOn>) => JSON.stringify(spy.mock.calls);

    it("on an insert error that quotes the row", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      upsert.mockResolvedValue({ error: { code: "23505", message: `duplicate key: Key (email)=(${SENTINEL_EMAIL})` } });
      expect((await POST(request({ email: SENTINEL_EMAIL }))).status).toBe(503);
      expect(logged(spy)).not.toContain(SENTINEL_EMAIL);
      expect(logged(spy)).toContain("23505");
      spy.mockRestore();
    });

    it("on a claim error that quotes the row", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: `bad row (${SENTINEL_EMAIL})` } });
      expect((await POST(request({ email: SENTINEL_EMAIL, consent_feed_emails: true }))).status).toBe(503);
      expect(logged(spy)).not.toContain(SENTINEL_EMAIL);
      spy.mockRestore();
    });

    it("on an unexpected exception that quotes the row", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      upsert.mockRejectedValue(new Error(`socket closed while writing ${SENTINEL_EMAIL}`));
      expect((await POST(request({ email: SENTINEL_EMAIL }))).status).toBe(503);
      expect(logged(spy)).not.toContain(SENTINEL_EMAIL);
      spy.mockRestore();
    });

    it("on a confirmation-email failure that quotes the recipient and the token", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      rpc.mockResolvedValue({ data: [claimedRow({ email: SENTINEL_EMAIL })], error: null });
      sendFeedConfirmation.mockRejectedValue(
        new Error(`validation_error: invalid to ${SENTINEL_EMAIL} for https://riskmodels.app/x/confirm?token=${SENTINEL_TOKEN}`),
      );
      expect((await POST(request({ email: SENTINEL_EMAIL, consent_feed_emails: true }))).status).toBe(200);
      await runAfter();
      expect(logged(spy)).not.toContain(SENTINEL_EMAIL);
      expect(logged(spy)).not.toContain(SENTINEL_TOKEN);
      expect(logged(spy)).toContain("validation_error");
      spy.mockRestore();
    });
  });
});
