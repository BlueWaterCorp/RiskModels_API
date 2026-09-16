import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@react-email/render";
import { PrepaidReceiptEmail } from "@/emails/prepaid-receipt";
import {
  buildPrepaidReceiptData,
  chargeFactsForPaymentIntent,
  displayNameFor,
  formatPaidAt,
  paymentMethodLabelFromCharge,
  prepaidReceiptSubject,
  sendPrepaidReceipt,
} from "@/lib/agent/prepaid-receipt";

/**
 * The receipt is the account-side confirmation of a prepay purchase; the
 * numbers it shows are the ones a customer reconciles against their card
 * statement, so they must survive rendering exactly. Shapes below mirror the
 * live 2026-09-16 $100 purchase (metadata prepay_usd=100, Link payment
 * method, no card block), not invented rows.
 */

const sendEmailMock = vi.fn();
vi.mock("@/lib/email-service", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

beforeEach(() => {
  sendEmailMock.mockReset();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://riskmodels.app");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("prepaid receipt data", () => {
  it("formats the Stripe unix timestamp as a UTC calendar date", () => {
    expect(formatPaidAt(1789582305)).toBe("September 16, 2026");
    expect(formatPaidAt("2026-09-03T16:46:04Z")).toBe("September 3, 2026");
  });

  it("uses the agent name unless it is just the email, then the local-part", () => {
    expect(displayNameFor("Lisa", "lisa@example.com")).toBe("Lisa");
    expect(displayNameFor("lisa@example.com", "lisa@example.com")).toBe("lisa");
    expect(displayNameFor(null, "lisa@example.com")).toBe("lisa");
    expect(displayNameFor("  ", "@")).toBe("Developer");
  });

  it("labels cards, Link and bank accounts; undefined when nothing usable", () => {
    expect(
      paymentMethodLabelFromCharge({
        type: "card",
        card: { brand: "visa", last4: "4242" },
      } as never),
    ).toBe("Visa •••• 4242");
    expect(paymentMethodLabelFromCharge({ type: "link", link: {} } as never)).toBe("Link");
    expect(
      paymentMethodLabelFromCharge({
        type: "us_bank_account",
        us_bank_account: { last4: "6789" },
      } as never),
    ).toBe("Bank account •••• 6789");
    expect(paymentMethodLabelFromCharge(null)).toBeUndefined();
  });

  it("subject carries the amount to two decimals", () => {
    expect(prepaidReceiptSubject(100)).toBe("Receipt: $100.00 RiskModels API credit");
    expect(prepaidReceiptSubject(25)).toBe("Receipt: $25.00 RiskModels API credit");
  });

  it("builds template props with the app balance page as the balance link", () => {
    const data = buildPrepaidReceiptData({
      userId: "u1",
      to: "lisa@example.com",
      name: "lisa@example.com",
      amountUsd: 100,
      newBalanceUsd: 142.291,
      paymentIntentId: "pi_123",
      paidAt: 1789582305,
      receiptUrl: "https://pay.stripe.com/receipts/x",
      paymentMethodLabel: "Link",
    });
    expect(data).toEqual({
      firstName: "lisa",
      amountUsd: 100,
      newBalanceUsd: 142.291,
      paymentIntentId: "pi_123",
      paidAtFormatted: "September 16, 2026",
      paymentMethodLabel: "Link",
      receiptUrl: "https://pay.stripe.com/receipts/x",
      balanceUrl: "https://riskmodels.app/get-key",
    });
  });
});

describe("chargeFactsForPaymentIntent", () => {
  it("reads receipt_url and method from an expanded latest_charge without calling Stripe", async () => {
    const retrieve = vi.fn();
    const stripe = { charges: { retrieve } } as never;
    const facts = await chargeFactsForPaymentIntent(stripe, {
      created: 1,
      latest_charge: {
        created: 2,
        receipt_url: "https://pay.stripe.com/receipts/abc",
        payment_method_details: { type: "card", card: { brand: "mastercard", last4: "1111" } },
      },
    } as never);
    expect(retrieve).not.toHaveBeenCalled();
    expect(facts).toEqual({
      paidAt: 2,
      receiptUrl: "https://pay.stripe.com/receipts/abc",
      paymentMethodLabel: "Mastercard •••• 1111",
    });
  });

  it("retrieves a string latest_charge and degrades to the intent date on failure", async () => {
    const retrieve = vi.fn().mockRejectedValue(new Error("stripe down"));
    const stripe = { charges: { retrieve } } as never;
    const facts = await chargeFactsForPaymentIntent(stripe, {
      created: 1789582305,
      latest_charge: "ch_1",
    } as never);
    expect(retrieve).toHaveBeenCalledWith("ch_1");
    expect(facts).toEqual({ paidAt: 1789582305 });
  });
});

describe("sendPrepaidReceipt", () => {
  it("sends the prepaid-receipt template with the user id for email_logs", async () => {
    sendEmailMock.mockResolvedValue({ success: true, messageId: "msg_1" });
    const result = await sendPrepaidReceipt({
      userId: "u1",
      to: "lisa@example.com",
      amountUsd: 100,
      newBalanceUsd: 142.29,
      paymentIntentId: "pi_123",
      paidAt: 1789582305,
    });
    expect(result).toEqual({ success: true, messageId: "msg_1" });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.template).toBe("prepaid-receipt");
    expect(call.to).toBe("lisa@example.com");
    expect(call.userId).toBe("u1");
    expect(call.subject).toBe("Receipt: $100.00 RiskModels API credit");
  });

  it("refuses to send without a recipient or with a non-positive amount", async () => {
    expect(
      await sendPrepaidReceipt({
        userId: "u1",
        to: "",
        amountUsd: 100,
        newBalanceUsd: 1,
        paymentIntentId: "pi_1",
        paidAt: 1,
      }),
    ).toEqual({ success: false, error: "no recipient email" });
    expect(
      await sendPrepaidReceipt({
        userId: "u1",
        to: "a@b.c",
        amountUsd: 0,
        newBalanceUsd: 1,
        paymentIntentId: "pi_1",
        paidAt: 1,
      }),
    ).toEqual({ success: false, error: "amount must be positive" });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

describe("PrepaidReceiptEmail render", () => {
  it("shows amount, balance, reference, method and the Stripe receipt link", async () => {
    const html = await render(
      PrepaidReceiptEmail({
        firstName: "lisa",
        amountUsd: 100,
        newBalanceUsd: 142.291,
        paymentIntentId: "pi_3UGNJ7IZr3LIUbdw0yplcdbA",
        paidAtFormatted: "September 16, 2026",
        paymentMethodLabel: "Link",
        receiptUrl: "https://pay.stripe.com/receipts/payment/abc",
        balanceUrl: "https://riskmodels.app/get-key",
      }),
    );
    expect(html.replace(/<!-- -->/g, "")).toContain("Hi lisa,");
    expect(html).toContain("$100.00");
    expect(html).toContain("$142.29");
    expect(html).toContain("pi_3UGNJ7IZr3LIUbdw0yplcdbA");
    expect(html).toContain("September 16, 2026");
    expect(html).toContain("Link");
    expect(html).toContain('href="https://pay.stripe.com/receipts/payment/abc"');
    expect(html).toContain("View Stripe receipt");
    expect(html).toContain("riskmodels.app/get-key");
  });

  it("omits the Stripe button and method row when Stripe gave nothing", async () => {
    const html = await render(
      PrepaidReceiptEmail({
        firstName: "lisa",
        amountUsd: 25,
        newBalanceUsd: 45,
        paymentIntentId: "pi_x",
        paidAtFormatted: "September 3, 2026",
        balanceUrl: "https://riskmodels.app/get-key",
      }),
    );
    expect(html).not.toContain("View Stripe receipt");
    expect(html).not.toContain("Payment method");
    expect(html).toContain("$25.00");
  });
});
