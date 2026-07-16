/**
 * H.92 (2026-07-06 CEO deprecation): axis=style was removed from the L* endpoints.
 * Both routes must fail loudly with a 400 carrying the canonical removal message —
 * never silently default to industry.
 */
import { describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";

vi.mock("@/lib/agent/billing-middleware", () => ({
  withBilling: <T extends (...args: unknown[]) => unknown>(handler: T) => handler,
}));

vi.mock("@/lib/risk/lstar-service", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/risk/lstar-service")
  >();
  return {
    ...actual,
    getLstarService: vi.fn(() => ({
      getLstar: vi.fn(async () => {
        throw new Error("should not reach the service on axis=style");
      }),
    })),
  };
});

vi.mock("@/lib/risk/batch-lstar-service", () => ({
  fetchBatchLstar: vi.fn(async () => {
    throw new Error("should not reach the batch service on axis=style");
  }),
  batchLstarToLongRows: vi.fn(() => []),
}));

vi.mock("@/lib/dal/risk-metadata", () => ({
  getRiskMetadata: vi.fn(async () => ({})),
}));

vi.mock("@/lib/api/webhooks", () => ({
  dispatchWebhookEvent: vi.fn(async () => undefined),
}));

import { LSTAR_STYLE_AXIS_REMOVED_MESSAGE } from "@/lib/api/schemas";
import type { BillingContext } from "@/lib/agent/billing-middleware";
import { GET as lstarGET } from "@/app/api/lstar/route";
import { POST as batchLstarPOST } from "@/app/api/batch/lstar/route";

type Handler = (
  req: NextRequest,
  ctx: BillingContext,
) => Promise<NextResponse>;

const GET = lstarGET as unknown as Handler;
const POST = batchLstarPOST as unknown as Handler;

const fakeContext: BillingContext = {
  userId: "test-user",
  requestId: "test-req",
  capabilityId: "lstar",
  costUsd: 0.02,
  startTime: Date.now(),
  rawFieldsPermitted: true,
};

describe("GET /api/lstar — axis=style removed (H.92)", () => {
  it("returns 400 with the v4 removal message", async () => {
    const res = await GET(
      new NextRequest(
        new Request("http://localhost/api/lstar?ticker=NVDA&axis=style"),
      ),
      fakeContext,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid request");
    expect(body.message).toBe(LSTAR_STYLE_AXIS_REMOVED_MESSAGE);
  });
});

describe("POST /api/batch/lstar — axis=style removed (H.92)", () => {
  it("returns 400 with the v4 removal message", async () => {
    const res = await POST(
      new NextRequest(
        new Request("http://localhost/api/batch/lstar", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tickers: ["NVDA", "AAPL"], axis: "style" }),
        }),
      ),
      fakeContext,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid request");
    expect(body.message).toBe(LSTAR_STYLE_AXIS_REMOVED_MESSAGE);
  });
});
