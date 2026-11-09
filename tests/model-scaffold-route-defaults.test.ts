import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/billing-middleware", () => ({
  withBilling: <T extends (...args: unknown[]) => unknown>(handler: T) => handler,
}));

vi.mock("@/lib/dal/fundamentals-zarr-reader", () => ({
  getFundamentalsForTicker: vi.fn(),
}));

import { NextRequest, type NextResponse } from "next/server";
import { getFundamentalsForTicker } from "@/lib/dal/fundamentals-zarr-reader";
import { GET as wrappedGET } from "@/app/api/fundamentals/[ticker]/model-scaffold/route";

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), "tests/fixtures/fundamentals/aapl-row-2026-06-30.json"), "utf8"),
) as { row: Record<string, unknown> };

const GET = wrappedGET as unknown as (request: NextRequest, context: unknown) => Promise<NextResponse>;

describe("model scaffold default disclosure header", () => {
  it("lists only assumptions the caller omitted", async () => {
    vi.mocked(getFundamentalsForTicker).mockResolvedValue({
      ticker: "AAPL",
      rows: [fixture.row],
    } as never);

    const response = await GET(
      new NextRequest(
        "http://localhost/api/fundamentals/AAPL/model-scaffold?as_of=2026-10-01&erp=0.06",
      ),
      {},
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Assumptions-Defaulted")).toBe("tax_rate");
  });
});
