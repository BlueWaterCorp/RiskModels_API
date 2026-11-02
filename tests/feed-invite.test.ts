import { beforeEach, describe, expect, it, vi } from "vitest";

const maybeSingle = vi.fn();
const selectEq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq: selectEq }));
const insertSingle = vi.fn();
const insertSelect = vi.fn(() => ({ single: insertSingle }));
const insert = vi.fn((_row: Record<string, unknown>) => ({ select: insertSelect }));
const updateSingle = vi.fn();
const updateSelect = vi.fn(() => ({ single: updateSingle }));
const updateEq = vi.fn(() => ({ select: updateSelect }));
const update = vi.fn((_patch: Record<string, unknown>) => ({ eq: updateEq }));
const from = vi.fn(() => ({ select, insert, update }));
const sendFeedInvite = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from }) }));
vi.mock("@/lib/feed-email", () => ({
  sendFeedInvite: (...args: unknown[]) => sendFeedInvite(...args),
}));

import { inviteToFeedWaitlist } from "@/lib/feed-invite";

const TOKEN = "3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f";
const base = { email: "guest@example.com", name: "G. Uest", unsubscribe_token: TOKEN };
const stored = (over: Record<string, unknown> = {}) => ({
  ...base,
  consent_feed_emails: false,
  unsubscribed_at: null,
  invited_at: null,
  ...over,
});
const input = { email: "  Guest@Example.COM ", name: "G. Uest", inviterName: "Conrad Gann" };

describe("inviteToFeedWaitlist", () => {
  beforeEach(() => {
    maybeSingle.mockReset().mockResolvedValue({ data: null, error: null });
    insertSingle.mockReset().mockResolvedValue({ data: stored({ invited_at: "2026-11-03T00:00:00Z" }), error: null });
    updateSingle.mockReset().mockResolvedValue({ data: stored({ invited_at: "2026-11-03T00:00:00Z" }), error: null });
    sendFeedInvite.mockReset().mockResolvedValue({ id: "email-1" });
    for (const m of [insert, update, from, selectEq, select, updateEq, insertSelect, updateSelect]) m.mockClear();
  });

  it("stores a new address as an unconsented invite and sends once", async () => {
    expect(await inviteToFeedWaitlist(input)).toBe("sent");
    const row = insert.mock.calls[0]![0];
    expect(row).toMatchObject({
      email: "guest@example.com",
      name: "G. Uest",
      source: "invite",
      invited_by: "Conrad Gann",
      consent_feed_emails: false,
    });
    expect(typeof row.invited_at).toBe("string");
    expect(sendFeedInvite).toHaveBeenCalledTimes(1);
    expect(sendFeedInvite.mock.calls[0]![1]).toMatchObject({ inviterName: "Conrad Gann" });
  });

  it("records the invite on a row that signed up without consent, and sends", async () => {
    maybeSingle.mockResolvedValue({ data: stored(), error: null });
    expect(await inviteToFeedWaitlist(input)).toBe("sent");
    expect(insert).not.toHaveBeenCalled();
    expect(update.mock.calls[0]![0]).toMatchObject({ invited_by: "Conrad Gann" });
    expect(sendFeedInvite).toHaveBeenCalledTimes(1);
  });

  it("does not invite someone already on the list, already invited, or unsubscribed", async () => {
    maybeSingle.mockResolvedValue({ data: stored({ consent_feed_emails: true }), error: null });
    expect(await inviteToFeedWaitlist(input)).toBe("already_on_list");
    maybeSingle.mockResolvedValue({ data: stored({ invited_at: "2026-10-30T00:00:00Z" }), error: null });
    expect(await inviteToFeedWaitlist(input)).toBe("already_invited");
    maybeSingle.mockResolvedValue({ data: stored({ unsubscribed_at: "2026-10-31T00:00:00Z" }), error: null });
    expect(await inviteToFeedWaitlist(input)).toBe("unsubscribed");
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(sendFeedInvite).not.toHaveBeenCalled();
  });

  it("rejects a malformed address without touching the table", async () => {
    expect(await inviteToFeedWaitlist({ ...input, email: "not-an-email" })).toBe("invalid_email");
    expect(from).not.toHaveBeenCalled();
  });

  it("writes and sends nothing on a dry run", async () => {
    expect(await inviteToFeedWaitlist({ ...input, dryRun: true })).toBe("dry_run");
    expect(insert).not.toHaveBeenCalled();
    expect(sendFeedInvite).not.toHaveBeenCalled();
  });

  it("throws a fixed message when the store fails, never the upstream text", async () => {
    insertSingle.mockResolvedValue({ data: null, error: { message: "duplicate key (email)=(guest@example.com)" } });
    await expect(inviteToFeedWaitlist(input)).rejects.toThrow("feed_invite_insert_failed");
  });
});
