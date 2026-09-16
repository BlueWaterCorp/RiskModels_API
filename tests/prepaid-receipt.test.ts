import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@react-email/render";
import { PrepaidReceiptEmail } from "@/emails/prepaid-receipt";
import {
  buildPrepaidReceiptData,
  chargeFactsForPaymentIntent,
  formatPaidAt,
  paymentMethodLabelFromCharge,
  prepaidReceiptSubject,
  printableName,
  receiptNumberFor,
  resolveAccountName,
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

const strip = (html: string) => html.replace(/<!-- -->/g, "");

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

  it("receipt number is deterministic: UTC date + PaymentIntent tail", () => {
    expect(receiptNumberFor("pi_3UGNJ7IZr3LIUbdw0yplcdbA", 1789582305)).toBe(
      "RM-20260916-PLCDBA",
    );
    expect(receiptNumberFor("pi_3UGNJ7IZr3LIUbdw0yplcdbA", "2026-09-16T18:11:45Z")).toBe(
      "RM-20260916-PLCDBA",
    );
    expect(receiptNumberFor("pi_ab", "not a date")).toBe("RM-00000000-0000AB");
  });

  it("prints a name only when it is a real name, never the email", () => {
    expect(printableName("Lisa Borland")).toBe("Lisa Borland");
    expect(printableName("lisa@example.com")).toBeUndefined();
    expect(printableName("  ")).toBeUndefined();
    expect(printableName(null)).toBeUndefined();
  });

  it("account holder comes from profiles.full_name, then the sign-in name, never the email", async () => {
    const adminWith = (fullName: string | null) =>
      ({
        from: () => ({
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { full_name: fullName } }) }),
          }),
        }),
      }) as never;
    const authUser = { user_metadata: { full_name: "Lisa Borland", email: "lisa@example.com" } } as never;
    expect(await resolveAccountName(adminWith("Profile Name"), "u1", authUser)).toBe("Profile Name");
    expect(await resolveAccountName(adminWith(""), "u1", authUser)).toBe("Lisa Borland");
    expect(await resolveAccountName(adminWith(null), "u1", null)).toBeUndefined();
    const broken = { from: () => { throw new Error("db down"); } } as never;
    expect(await resolveAccountName(broken, "u1", authUser)).toBe("Lisa Borland");
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

  it("subject carries the receipt number and the amount to two decimals", () => {
    expect(prepaidReceiptSubject(100, "RM-20260916-PLCDBA")).toBe(
      "Receipt RM-20260916-PLCDBA: $100.00 RiskModels API credit",
    );
  });

  it("builds template props with the app balance page as the balance link", () => {
    const data = buildPrepaidReceiptData({
      userId: "u1",
      to: "lisa@example.com",
      accountName: "Lisa Borland",
      cardholderName: "Molly Messenger",
      statementDescriptor: "RISKMODELS",
      amountUsd: 100,
      newBalanceUsd: 142.291,
      paymentIntentId: "pi_3UGNJ7IZr3LIUbdw0yplcdbA",
      paidAt: 1789582305,
      paymentMethodLabel: "Link",
    });
    expect(data).toEqual({
      receiptNumber: "RM-20260916-PLCDBA",
      paidAtFormatted: "September 16, 2026",
      accountName: "Lisa Borland",
      accountEmail: "lisa@example.com",
      cardholderName: "Molly Messenger",
      statementDescriptor: "RISKMODELS",
      amountUsd: 100,
      taxUsd: undefined,
      newBalanceUsd: 142.291,
      paymentIntentId: "pi_3UGNJ7IZr3LIUbdw0yplcdbA",
      paymentMethodLabel: "Link",
      balanceUrl: "https://riskmodels.app/get-key",
    });
  });
});

describe("chargeFactsForPaymentIntent", () => {
  it("reads method, cardholder and descriptor from an expanded latest_charge without calling Stripe", async () => {
    const retrieve = vi.fn();
    const stripe = { charges: { retrieve } } as never;
    const facts = await chargeFactsForPaymentIntent(stripe, {
      created: 1,
      latest_charge: {
        created: 2,
        billing_details: { name: " Molly Messenger " },
        calculated_statement_descriptor: "RISKMODELS",
        payment_method_details: { type: "card", card: { brand: "mastercard", last4: "1111" } },
      },
    } as never);
    expect(retrieve).not.toHaveBeenCalled();
    expect(facts).toEqual({
      paidAt: 2,
      paymentMethodLabel: "Mastercard •••• 1111",
      cardholderName: "Molly Messenger",
      statementDescriptor: "RISKMODELS",
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
      paymentIntentId: "pi_3UGNJ7IZr3LIUbdw0yplcdbA",
      paidAt: 1789582305,
    });
    expect(result).toEqual({ success: true, messageId: "msg_1" });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.template).toBe("prepaid-receipt");
    expect(call.to).toBe("lisa@example.com");
    expect(call.userId).toBe("u1");
    expect(call.subject).toBe("Receipt RM-20260916-PLCDBA: $100.00 RiskModels API credit");
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
  it("shows issuer, billed-to, cardholder, line item, total, payment record and balance", async () => {
    const html = strip(
      await render(
        PrepaidReceiptEmail({
          receiptNumber: "RM-20260916-PLCDBA",
          paidAtFormatted: "September 16, 2026",
          accountName: "Lisa Borland",
          accountEmail: "lisa@example.com",
          cardholderName: "Molly Messenger",
          statementDescriptor: "RISKMODELS",
          amountUsd: 100,
          newBalanceUsd: 142.291,
          paymentIntentId: "pi_3UGNJ7IZr3LIUbdw0yplcdbA",
          paymentMethodLabel: "Link",
          balanceUrl: "https://riskmodels.app/get-key",
        }),
      ),
    );
    expect(html).toContain("RM-20260916-PLCDBA");
    expect(html).toContain("Blue Water Macro Corp.");
    expect(html).toContain("A Delaware corporation");
    expect(html).toContain("Lisa Borland");
    expect(html).toContain("lisa@example.com");
    expect(html).toContain("Cardholder");
    expect(html).toContain("Molly Messenger");
    expect(html).toContain("On your card statement as");
    expect(html).toContain("RISKMODELS");
    expect(html).toContain("Prepaid API credit");
    expect(html).toContain("Total paid (USD)");
    expect(html).toContain("$100.00");
    expect(html).toContain("$142.29");
    expect(html).toContain("pi_3UGNJ7IZr3LIUbdw0yplcdbA");
    expect(html).toContain("September 16, 2026");
    expect(html).toContain("Link");
    expect(html).not.toContain("pay.stripe.com");
    expect(html).toContain('href="https://riskmodels.app/get-key"');
    expect(html).toContain("https://riskmodels.app/riskmodels-wordmark.png");
    // No tax given → no Subtotal / Tax rows.
    expect(html).not.toContain("Subtotal");
  });

  it("adds subtotal and tax rows when tax is known, and omits optional rows when absent", async () => {
    const html = strip(
      await render(
        PrepaidReceiptEmail({
          receiptNumber: "RM-20260903-BTCY00",
          paidAtFormatted: "September 3, 2026",
          accountEmail: "lisa@example.com",
          amountUsd: 25,
          taxUsd: 0,
          newBalanceUsd: 45,
          paymentIntentId: "pi_x",
          balanceUrl: "https://riskmodels.app/get-key",
        }),
      ),
    );
    expect(html).toContain("Subtotal");
    expect(html).toContain("Tax");
    expect(html).toContain("$0.00");
    expect(html).toContain("$25.00");
    expect(html).not.toContain("Payment method");
    expect(html).not.toContain("Cardholder");
    expect(html).not.toContain("On your card statement as");
    expect(html).toContain("Billed to");
    expect(html).toContain("lisa@example.com");
  });
});
