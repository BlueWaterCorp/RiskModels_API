import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));

import { listFeedEditionRecipients } from "@/lib/feed-recipients";

describe("listFeedEditionRecipients", () => {
  beforeEach(() => rpc.mockReset());

  it("asks the database function, which holds the delivery rule, and returns its rows", async () => {
    rpc.mockResolvedValue({
      data: [
        { email: "carol@corp.com", unsubscribe_token: "t1" },
        { email: "ops@corp.com", unsubscribe_token: "t2" },
      ],
      error: null,
    });
    expect(await listFeedEditionRecipients()).toEqual([
      { email: "carol@corp.com", unsubscribe_token: "t1" },
      { email: "ops@corp.com", unsubscribe_token: "t2" },
    ]);
    expect(rpc).toHaveBeenCalledWith("feed_waitlist_edition_recipients");
  });

  it("returns an empty list when nobody has confirmed", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await listFeedEditionRecipients()).toEqual([]);
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await listFeedEditionRecipients()).toEqual([]);
  });

  it("throws a fixed message, never the upstream text, which can quote an address", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "bad row (owner@example.com)" } });
    await expect(listFeedEditionRecipients()).rejects.toThrow("feed_recipients_failed");
    await expect(listFeedEditionRecipients()).rejects.not.toThrow(/owner@example\.com/);
  });
});
