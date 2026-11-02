import { beforeEach, describe, expect, it, vi } from "vitest";

const maybeSingle = vi.fn();
const selectEq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn((_cols: string) => ({ eq: selectEq }));
const upsert = vi.fn(async (_row: Record<string, unknown>, _opts?: Record<string, unknown>) => ({
  error: null as unknown,
}));
// update(patch).eq("email", e).eq("invite_claim_id", id).is("invited_at", null).select("email") resolves to { data, error }.
const updateSelect = vi.fn(async (_cols: string) => ({ data: [{ email: "guest@example.com" }] as unknown, error: null as unknown }));
const updateIs = vi.fn((_col: string, _val: unknown) => ({ select: updateSelect }));
const updateEqClaim = vi.fn((_col: string, _val: unknown) => ({ is: updateIs }));
const updateEqEmail = vi.fn((_col: string, _val: unknown) => ({ eq: updateEqClaim }));
const update = vi.fn((_patch: Record<string, unknown>) => ({ eq: updateEqEmail }));
const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({
  data: [] as unknown,
  error: null as unknown,
}));
const from = vi.fn(() => ({ select, upsert, update }));
const sendFeedInvite = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from, rpc }) }));
vi.mock("@/lib/feed-email", () => ({
  sendFeedInvite: (...args: unknown[]) => sendFeedInvite(...args),
}));

import { FeedInviteError, inviteToFeedWaitlist } from "@/lib/feed-invite";

const TOKEN = "3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f";
const CLAIM_A = "aaaaaaaa-1d2a-4b5c-9e8f-0a1b2c3d4e5f";
const state = (over: Record<string, unknown> = {}) => ({
  consent_feed_emails: false,
  unsubscribed_at: null,
  invited_at: null,
  ...over,
});
const claimed = (claim_id = CLAIM_A) => ({
  id: "row-1",
  email: "guest@example.com",
  name: "G. Uest",
  unsubscribe_token: TOKEN,
  claim_id,
});
const input = { email: "  Guest@Example.COM ", name: "G. Uest", inviterName: "Conrad Gann" };

describe("inviteToFeedWaitlist", () => {
  beforeEach(() => {
    maybeSingle.mockReset().mockResolvedValue({ data: null, error: null });
    upsert.mockReset().mockResolvedValue({ error: null });
    updateSelect.mockReset().mockResolvedValue({ data: [{ email: "guest@example.com" }], error: null });
    rpc.mockReset().mockResolvedValue({ data: [claimed()], error: null });
    sendFeedInvite.mockReset().mockResolvedValue({ id: "email-1" });
    for (const m of [select, selectEq, update, updateEqEmail, updateEqClaim, updateIs, from]) m.mockClear();
  });

  it("stores a new address unconsented, claims atomically, sends once, then marks it sent", async () => {
    expect(await inviteToFeedWaitlist(input)).toBe("sent");
    expect(upsert.mock.calls[0]![0]).toMatchObject({
      email: "guest@example.com",
      name: "G. Uest",
      source: "invite",
      consent_feed_emails: false,
    });
    expect(upsert.mock.calls[0]![1]).toEqual({ onConflict: "email", ignoreDuplicates: true });
    expect(rpc).toHaveBeenCalledWith("feed_waitlist_claim_invite", {
      p_email: "guest@example.com",
      p_invited_by: "Conrad Gann",
      p_stale_seconds: 900,
    });
    expect(sendFeedInvite).toHaveBeenCalledTimes(1);
    expect(sendFeedInvite.mock.calls[0]![0]).toMatchObject({ id: "row-1", email: "guest@example.com" });
    expect(sendFeedInvite.mock.calls[0]![1]).toMatchObject({ inviterName: "Conrad Gann" });
    // invited_at is written only after the send, and only for THIS run's claim.
    const mark = update.mock.calls.at(-1)![0];
    expect(typeof mark.invited_at).toBe("string");
    expect(mark.invite_claimed_at).toBeNull();
    expect(mark.invite_claim_id).toBeNull();
    expect(updateEqClaim).toHaveBeenLastCalledWith("invite_claim_id", CLAIM_A);
    expect(updateIs).toHaveBeenLastCalledWith("invited_at", null);
  });

  it("claims an existing unconsented row without inserting", async () => {
    maybeSingle.mockResolvedValue({ data: state(), error: null });
    expect(await inviteToFeedWaitlist(input)).toBe("sent");
    expect(upsert).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("does not claim or send for an address already on the list, already invited, or unsubscribed", async () => {
    maybeSingle.mockResolvedValue({ data: state({ consent_feed_emails: true }), error: null });
    expect(await inviteToFeedWaitlist(input)).toBe("already_on_list");
    maybeSingle.mockResolvedValue({ data: state({ invited_at: "2026-10-30T00:00:00Z" }), error: null });
    expect(await inviteToFeedWaitlist(input)).toBe("already_invited");
    maybeSingle.mockResolvedValue({ data: state({ unsubscribed_at: "2026-10-31T00:00:00Z" }), error: null });
    expect(await inviteToFeedWaitlist(input)).toBe("unsubscribed");
    expect(rpc).not.toHaveBeenCalled();
    expect(sendFeedInvite).not.toHaveBeenCalled();
  });

  it("two concurrent runs send once: the loser's claim matches nothing and it does not send", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    maybeSingle.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: state(), error: null });
    expect(await inviteToFeedWaitlist(input)).toBe("in_progress");
    expect(sendFeedInvite).not.toHaveBeenCalled();
    maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: state({ invited_at: "2026-11-03T00:00:00Z" }), error: null });
    expect(await inviteToFeedWaitlist(input)).toBe("already_invited");
    expect(sendFeedInvite).not.toHaveBeenCalled();
  });

  describe("claim ownership (stale-claim race)", () => {
    it("releases only its OWN claim after a failed send, so a retry can send", async () => {
      sendFeedInvite.mockRejectedValue(new Error("validation_error: invalid to guest@example.com"));
      const err = await inviteToFeedWaitlist(input).catch((e) => e);
      expect(err).toBeInstanceOf(FeedInviteError);
      expect(err.event).toBe("send_failed");
      expect(err.message).toBe("feed_invite_send_failed");
      expect(update).toHaveBeenCalledTimes(1);
      expect(update.mock.calls[0]![0]).toEqual({ invite_claimed_at: null, invite_claim_id: null });
      // Scoped to this run's claim id: a run whose claim was retaken cannot clear the newer one.
      expect(updateEqClaim).toHaveBeenCalledWith("invite_claim_id", CLAIM_A);
      expect(updateIs).toHaveBeenCalledWith("invited_at", null);
    });

    it("a run whose claim went stale and was retaken fails to release: nothing matches, the newer claim is untouched", async () => {
      sendFeedInvite.mockRejectedValue(new Error("boom"));
      updateSelect.mockResolvedValue({ data: [], error: null }); // another run holds a newer claim id now
      const err = await inviteToFeedWaitlist(input).catch((e) => e);
      expect(err.event).toBe("send_failed"); // not release_failed: matching no row is the correct outcome
      expect(updateEqClaim).toHaveBeenCalledWith("invite_claim_id", CLAIM_A);
      expect(update).toHaveBeenCalledTimes(1); // no second, unscoped update
    });

    it("a run whose claim was retaken still reports sent, because the provider accepted it under the idempotency key", async () => {
      updateSelect.mockResolvedValue({ data: [], error: null }); // the mark matches nothing: someone else owns the claim
      expect(await inviteToFeedWaitlist(input)).toBe("sent");
      expect(sendFeedInvite).toHaveBeenCalledTimes(1);
      expect(updateEqClaim).toHaveBeenLastCalledWith("invite_claim_id", CLAIM_A);
    });

    it("uses the claim id the database returned, whatever it is", async () => {
      const CLAIM_B = "bbbbbbbb-1d2a-4b5c-9e8f-0a1b2c3d4e5f";
      rpc.mockResolvedValue({ data: [claimed(CLAIM_B)], error: null });
      await inviteToFeedWaitlist(input);
      expect(updateEqClaim).toHaveBeenLastCalledWith("invite_claim_id", CLAIM_B);
    });
  });

  it("reports release_failed if the claim cannot be released after a failed send", async () => {
    sendFeedInvite.mockRejectedValue(new Error("boom"));
    updateSelect.mockResolvedValue({ data: null, error: { message: "nope" } });
    const err = await inviteToFeedWaitlist(input).catch((e) => e);
    expect(err.event).toBe("release_failed");
  });

  it("reports mark_failed if the sent mark cannot be written (the idempotency key prevents a duplicate on retry)", async () => {
    updateSelect.mockResolvedValue({ data: null, error: { message: "nope" } });
    const err = await inviteToFeedWaitlist(input).catch((e) => e);
    expect(err.event).toBe("mark_failed");
    expect(sendFeedInvite).toHaveBeenCalledTimes(1);
  });

  it("throws a fixed event and never the upstream text", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "duplicate key (email)=(guest@example.com)" } });
    const err = await inviteToFeedWaitlist(input).catch((e) => e);
    expect(err).toBeInstanceOf(FeedInviteError);
    expect(err.message).toBe("feed_invite_claim_failed");
    expect(JSON.stringify(err.message)).not.toContain("guest@example.com");
  });

  it("rejects a malformed address without touching the table", async () => {
    expect(await inviteToFeedWaitlist({ ...input, email: "not-an-email" })).toBe("invalid_email");
    expect(from).not.toHaveBeenCalled();
  });

  it("writes and sends nothing on a dry run", async () => {
    expect(await inviteToFeedWaitlist({ ...input, dryRun: true })).toBe("dry_run");
    expect(upsert).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(sendFeedInvite).not.toHaveBeenCalled();
  });
});
