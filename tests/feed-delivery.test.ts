import { beforeEach, describe, expect, it, vi } from "vitest";

const sendFeedDeliveryConfirmation = vi.fn();
vi.mock("@/lib/feed-email", () => ({
  sendFeedDeliveryConfirmation: (...a: unknown[]) => sendFeedDeliveryConfirmation(...a),
}));

import { askDeliveryAddressToConfirm, DELIVERY_CLAIM_VALUES } from "@/lib/feed-delivery";

const rpc = vi.fn();
const admin = { rpc } as unknown as Parameters<typeof askDeliveryAddressToConfirm>[0];

describe("asking a team inbox to confirm resets anything planted on it", () => {
  beforeEach(() => {
    rpc.mockReset();
    sendFeedDeliveryConfirmation.mockReset().mockResolvedValue({ id: "e1" });
  });

  it("claims as a submission with marketing off and no terms or referral", async () => {
    rpc.mockResolvedValue({ data: [{ id: "f1", email: "desk@example.com", name: null, unsubscribe_token: "t" }], error: null });
    expect(await askDeliveryAddressToConfirm(admin, "desk@example.com", { email: "conrad@bwmacro.com", name: "Conrad Gann" })).toBe(
      "confirmation_sent",
    );
    const [fn, args] = rpc.mock.calls[0]!;
    expect(fn).toBe("feed_waitlist_claim_confirmation");
    expect(args).toMatchObject({
      p_email: "desk@example.com",
      p_from_submission: true,
      p_marketing_opt_in: false,
      p_terms_version: null,
      p_referred_by: null,
    });
    expect(DELIVERY_CLAIM_VALUES).toEqual({
      p_from_submission: true,
      p_marketing_opt_in: false,
      p_terms_version: null,
      p_referred_by: null,
    });
  });

  // Attack sequence (the database side runs on Postgres in BWMACRO #628's migration test):
  //   1. a stranger signs up desk@example.com with marketing ticked; the claim stores marketing = true as pending;
  //   2. desk@ ignores that email;
  //   3. a contact later names desk@ as its team inbox, and this claim is sent;
  //   4. desk@ clicks the team-inbox confirmation.
  // Step 3 passes p_from_submission with marketing false, which replaces the planted pending value, so the
  // confirm in step 4 applies marketing = false.
  it("is the claim the attack sequence relies on: the team-inbox claim always overwrites the pending marketing value", async () => {
    rpc.mockResolvedValue({ data: [{ id: "f1", email: "desk@example.com", name: null, unsubscribe_token: "t" }], error: null });
    await askDeliveryAddressToConfirm(admin, "desk@example.com", { email: "conrad@bwmacro.com", name: null });
    const args = rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(args.p_from_submission).toBe(true);
    expect(args.p_marketing_opt_in).toBe(false);
  });

  it("sends nothing when the claim matches no row", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await askDeliveryAddressToConfirm(admin, "desk@example.com", { email: "conrad@bwmacro.com", name: null })).toBe("not_sent");
    expect(sendFeedDeliveryConfirmation).not.toHaveBeenCalled();
  });
});
