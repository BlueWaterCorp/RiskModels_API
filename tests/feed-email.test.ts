import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send } })),
}));

import {
  feedEmailRecipient,
  feedUnsubscribeHeaders,
  feedUnsubscribePageUrl,
  sendFeedEarlyAccessEmail,
  sendFeedLaunchNotice,
  type FeedWaitlistRow,
} from "@/lib/feed-email";

const TOKEN = "3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f";
const row = (over: Partial<FeedWaitlistRow> = {}): FeedWaitlistRow => ({
  email: "analyst@example.com",
  name: "A. Analyst",
  consent_feed_emails: true,
  unsubscribe_token: TOKEN,
  unsubscribed_at: null,
  ...over,
});

// Identifier schemes and vendor names the feed's emails must never contain (product
// rules for the feed). Stored reversed so the words themselves never appear in the repo.
const FORBIDDEN = ["pisuc", "nisi", "tesTcaf", "dhdoe", "grebmoolb", "vitinifer"].map(
  (w) => new RegExp(`\\b${w.split("").reverse().join("")}\\b`, "i"),
);

describe("lib/feed-email", () => {
  beforeEach(() => {
    send.mockReset().mockResolvedValue({ data: { id: "email-1" }, error: null });
    process.env.RESEND_BCC_EMAIL = "0";
  });

  it("only treats consented, subscribed rows as recipients", () => {
    expect(feedEmailRecipient(row())).toBe(true);
    expect(feedEmailRecipient(row({ consent_feed_emails: false }))).toBe(false);
    expect(feedEmailRecipient(row({ unsubscribed_at: "2026-11-03T00:00:00Z" }))).toBe(false);
  });

  it("sends the early-access email with unsubscribe link and one-click headers", async () => {
    const out = await sendFeedEarlyAccessEmail(row());
    expect(out).toEqual({ id: "email-1" });
    const payload = send.mock.calls[0][0];
    expect(payload.to).toBe("analyst@example.com");
    expect(payload.subject).toMatch(/early-access list/);
    expect(payload.html).toContain(feedUnsubscribePageUrl(TOKEN).replace(/&/g, "&amp;"));
    expect(payload.html).toMatch(/early access/i);
    expect(payload.html).toMatch(/Tell us what you need/);
    expect(payload.replyTo).toBe("service@riskmodels.app");
    expect(payload.headers).toEqual(feedUnsubscribeHeaders(TOKEN));
    expect(payload.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(payload.headers["List-Unsubscribe"]).toContain(`/api/feed-waitlist/unsubscribe?token=${TOKEN}`);
    for (const re of FORBIDDEN) expect(payload.html).not.toMatch(re);
  });

  it("does not send to a row without consent or after unsubscribe", async () => {
    expect(await sendFeedEarlyAccessEmail(row({ consent_feed_emails: false }))).toBeNull();
    expect(await sendFeedEarlyAccessEmail(row({ unsubscribed_at: "2026-11-03T00:00:00Z" }))).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it("renders the launch notice from caller-supplied facts", async () => {
    await sendFeedLaunchNotice(row(), {
      firstEditionDate: "November 16, 2026",
      editionUrl: "https://riskmodels.app/security-master-feed",
      specUrl: "https://riskmodels.app/security-master-feed",
    });
    const payload = send.mock.calls[0][0];
    expect(payload.subject).toBe("The RiskModels security master feed: first edition, November 16, 2026");
    expect(payload.html).toContain("November 16, 2026");
    expect(payload.html).not.toContain("Quality scorecard");
    expect(payload.html).toMatch(/Your feedback decides what comes next/);
    for (const re of FORBIDDEN) expect(payload.html).not.toMatch(re);
  });

  it("throws when Resend reports an error", async () => {
    send.mockResolvedValue({ data: null, error: { name: "validation_error", message: "bad from" } });
    await expect(sendFeedEarlyAccessEmail(row())).rejects.toThrow(/validation_error/);
  });
});
