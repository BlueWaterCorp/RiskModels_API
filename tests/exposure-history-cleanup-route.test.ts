import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const cleanup = vi.fn(async (_api: unknown, opts: Record<string, unknown>) => ({ errors: [], deleted: 0, opts }));
vi.mock("@/lib/supabase/exposure-history-cleanup", () => ({
  cleanupExposureHistory: (api: unknown, opts: Record<string, unknown>) => cleanup(api, opts),
  maxAgeDaysFromEnv: () => 7,
  supabaseBucketApi: () => ({}),
}));
vi.mock("@/lib/dal/zarr-reader", () => ({ readExposureMonthEndBuiltUtc: async () => "2026-10-08T00:00:00Z" }));

import { GET } from "@/app/api/cron/exposure-history-cleanup/route";

const req = (auth?: string, q = "") =>
  new NextRequest(`http://test/api/cron/exposure-history-cleanup${q}`, {
    headers: auth ? { authorization: auth } : {},
  });

describe("GET /api/cron/exposure-history-cleanup", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    cleanup.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects missing or wrong secrets", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer nope"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(req("Bearer "))).status).toBe(401);
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("runs with the current panel build and honours dry_run", async () => {
    const res = await GET(req("Bearer s3cret", "?dry_run=1"));
    expect(res.status).toBe(200);
    expect(cleanup.mock.calls[0][1]).toMatchObject({ currentBuiltUtc: "2026-10-08T00:00:00Z", dryRun: true, maxAgeDays: 7 });
  });
});
