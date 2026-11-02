import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send } })),
}));

import {
  feedEmailRecipient,
  feedConfirmPageUrl,
  feedUnsubscribeHeaders,
  feedUnsubscribePageUrl,
  sendFeedConfirmation,
  sendFeedEarlyAccessEmail,
  sendFeedInvite,
  sendFeedLaunchNotice,
  type FeedWaitlistRow,
} from "@/lib/feed-email";

const TOKEN = "3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f";
const CONFIRM_TOKEN = "B".repeat(43);
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
const FORBIDDEN = [
  "pisuc",
  "nisi",
  "tesTcaf",
  "dhdoe",
  "grebmoolb",
  "vitinifer",
  "arrab",
  "amoixa",
  "icsm",
].map((w) => new RegExp(`\\b${w.split("").reverse().join("")}\\b`, "i"));

/** Undo the HTML entity escaping React Email applies to text nodes. */
function unescapeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Pull the JSON descriptor out of the HTML or the plain-text part. */
function descriptorFrom(raw: string): Record<string, unknown> {
  const body = unescapeHtml(raw);
  const start = body.indexOf('"schema": "riskmodels.feed-descriptor/1"');
  expect(start).toBeGreaterThan(-1);
  const open = body.lastIndexOf("{", start);
  let depth = 0;
  for (let i = open; i < body.length; i++) {
    if (body[i] === "{") depth++;
    if (body[i] === "}" && --depth === 0) return JSON.parse(body.slice(open, i + 1));
  }
  throw new Error("descriptor not closed");
}

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
    for (const re of FORBIDDEN) {
      expect(payload.html).not.toMatch(re);
      expect(payload.text).not.toMatch(re);
    }
  });

  it("prints the mailing address in the footer of every feed email", async () => {
    await sendFeedEarlyAccessEmail(row());
    await sendFeedConfirmation({ email: "c@example.com", name: null, unsubscribe_token: TOKEN }, CONFIRM_TOKEN);
    await sendFeedInvite(
      { id: "row-9", email: "g@example.com", name: null, unsubscribe_token: TOKEN, unsubscribed_at: null },
      { inviterName: "Conrad Gann" },
    );
    await sendFeedLaunchNotice(row(), {
      firstEditionDate: "November 16, 2026",
      editionUrl: "https://riskmodels.app/security-master-feed",
      specUrl: "https://riskmodels.app/security-master-feed",
    });
    expect(send).toHaveBeenCalledTimes(4);
    for (const [payload] of send.mock.calls) {
      for (const body of [payload.html, payload.text]) {
        expect(body).toContain("1001 Bridgeway, P.O. Box 510, Sausalito, CA 94965");
      }
    }
  });

  it("uses the horizontal logo, not the stacked mark", async () => {
    await sendFeedEarlyAccessEmail(row());
    const { html } = send.mock.calls[0][0];
    expect(html).toContain("https://riskmodels.app/riskmodels-logo-horizontal.png");
    expect(html).not.toContain("riskmodels.app/logo.png");
  });

  it("explains how the feed fits with existing platforms and processes, naming no vendor", async () => {
    await sendFeedEarlyAccessEmail(row());
    const { html, text } = send.mock.calls[0][0];
    for (const body of [html, text]) {
      expect(body).toContain("How it fits with what you already use");
      expect(body).toContain("independent record to check them against");
      expect(body).toContain("in-house security master processes");
    }
  });

  it("carries a machine-readable descriptor in both the HTML and the plain-text part", async () => {
    await sendFeedEarlyAccessEmail(row());
    const { html, text } = send.mock.calls[0][0];
    for (const body of [html, text]) {
      expect(body).toContain("For agents and automation");
      expect(body).toContain("https://riskmodels.app/security-master-feed/descriptor.json");
      const d = descriptorFrom(body) as Record<string, any>;
      expect(d.status).toBe("early_access");
      expect(d.first_edition).toBeNull();
      expect(d.scope.keys).toEqual(["figi", "cik", "riskmodels_id", "ticker"]);
      expect(Array.isArray(d.relevant_if)).toBe(true);
      expect(Array.isArray(d.how_to_evaluate)).toBe(true);
      expect(d.contact).toBe("service@riskmodels.app");
    }
  });

  it("does not send to a row without consent or after unsubscribe", async () => {
    expect(await sendFeedEarlyAccessEmail(row({ consent_feed_emails: false }))).toBeNull();
    expect(await sendFeedEarlyAccessEmail(row({ unsubscribed_at: "2026-11-03T00:00:00Z" }))).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it("renders the launch notice from caller-supplied facts and marks the descriptor published", async () => {
    await sendFeedLaunchNotice(row(), {
      firstEditionDate: "November 16, 2026",
      firstEditionIso: "2026-11-16",
      editionUrl: "https://riskmodels.app/security-master-feed",
      specUrl: "https://riskmodels.app/security-master-feed",
    });
    const payload = send.mock.calls[0][0];
    expect(payload.subject).toBe("The RiskModels security master feed: first edition, November 16, 2026");
    expect(payload.html).toContain("November 16, 2026");
    expect(payload.html).not.toContain("Quality scorecard");
    expect(payload.html).toMatch(/Your feedback decides what comes next/);
    const d = descriptorFrom(payload.html) as Record<string, any>;
    expect(d.status).toBe("published");
    expect(d.first_edition).toBe("2026-11-16");
    for (const re of FORBIDDEN) expect(payload.html).not.toMatch(re);
  });

  describe("personal invitation", () => {
    const invitee = { id: "row-1", email: "guest@example.com", name: "G. Uest", unsubscribe_token: TOKEN, unsubscribed_at: null };

    it("says who invited the recipient and promises no further email unless they join", async () => {
      const out = await sendFeedInvite(invitee, { inviterName: "Conrad Gann", inviterRole: "founder of RiskModels" });
      expect(out).toEqual({ id: "email-1" });
      const payload = send.mock.calls[0][0];
      expect(payload.subject).toBe("Conrad Gann invited you to see the RiskModels security master feed");
      for (const body of [payload.html, payload.text]) {
        expect(body).toContain("You have been invited by");
        expect(body).toContain("Conrad Gann");
        expect(body).toMatch(/will not email you about the feed again unless you join/);
        expect(body).toContain("For agents and automation");
      }
      expect(payload.html).toContain("utm_source=invite");
      expect(payload.html).toContain(feedUnsubscribePageUrl(TOKEN).replace(/&/g, "&amp;"));
      expect(payload.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      for (const re of FORBIDDEN) {
        expect(payload.html).not.toMatch(re);
        expect(payload.text).not.toMatch(re);
      }
    });

    it("sends with an idempotency key built from the row id, so a retry cannot deliver twice", async () => {
      await sendFeedInvite(invitee, { inviterName: "Conrad Gann" });
      expect(send.mock.calls[0][1]).toEqual({ idempotencyKey: "feed-invite/row-1" });
    });

    it("includes a personal note when given", async () => {
      await sendFeedInvite(invitee, { inviterName: "Conrad Gann", note: "You asked about ticker history last week." });
      expect(send.mock.calls[0][0].html).toContain("You asked about ticker history last week.");
    });

    it("sends nothing to an unsubscribed address", async () => {
      expect(
        await sendFeedInvite({ ...invitee, unsubscribed_at: "2026-11-03T00:00:00Z" }, { inviterName: "Conrad Gann" }),
      ).toBeNull();
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe("confirmation request (double opt-in)", () => {
    const pending = { email: "owner@example.com", name: "O. Wner", unsubscribe_token: TOKEN };

    it("links to the confirm page with the token and says the address is not on the list until then", async () => {
      const out = await sendFeedConfirmation(pending, CONFIRM_TOKEN);
      expect(out).toEqual({ id: "email-1" });
      const payload = send.mock.calls[0][0];
      expect(payload.to).toBe("owner@example.com");
      expect(payload.subject).toBe("Confirm your email for the RiskModels security master feed");
      expect(feedConfirmPageUrl(CONFIRM_TOKEN)).toBe(
        `https://riskmodels.app/security-master-feed/confirm?token=${CONFIRM_TOKEN}`,
      );
      for (const body of [payload.html, payload.text]) {
        expect(body).toContain(`/security-master-feed/confirm?token=${CONFIRM_TOKEN}`);
        expect(body).toMatch(/not on the list until you do/);
        expect(body).toMatch(/If you did not ask to join, ignore this email/);
      }
      expect(payload.headers).toEqual(feedUnsubscribeHeaders(TOKEN));
      for (const re of FORBIDDEN) {
        expect(payload.html).not.toMatch(re);
        expect(payload.text).not.toMatch(re);
      }
    });

    it("is not an idempotent invitation: no idempotency key, so a legitimate resend after the interval goes out", async () => {
      await sendFeedConfirmation(pending, CONFIRM_TOKEN);
      expect(send.mock.calls[0][1]).toBeUndefined();
    });
  });

  it("throws when Resend reports an error", async () => {
    send.mockResolvedValue({ data: null, error: { name: "validation_error", message: "bad from" } });
    await expect(sendFeedEarlyAccessEmail(row())).rejects.toThrow(/validation_error/);
  });
});
