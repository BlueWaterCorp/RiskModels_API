import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Stub Upstash client: scan/del behaviour is set per test. This exercises
// error propagation from the real deleteCachePattern through the real
// purge route — no data is involved.
const { scan, del } = vi.hoisted(() => ({ scan: vi.fn(), del: vi.fn() }));

vi.mock("@/lib/upstash-redis-config", () => ({
  isUpstashRedisConfigured: () => true,
}));

vi.mock("@upstash/redis", () => ({
  Redis: class {
    scan = scan;
    del = del;
  },
}));

import { deleteCachePattern } from "@/lib/cache/redis";
import { POST } from "@/app/api/admin/cache/fundamentals/route";

const PATTERN = "riskmodels:fundamentals_zarr:*";

function request(): NextRequest {
  return new NextRequest("http://localhost/api/admin/cache/fundamentals", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
  });
}

describe("deleteCachePattern Redis error propagation", () => {
  beforeEach(() => {
    scan.mockReset();
    del.mockReset();
    process.env.CRON_SECRET = "test-secret";
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    vi.restoreAllMocks();
  });

  it("throws when Redis scan fails", async () => {
    scan.mockRejectedValue(new Error("scan failed"));
    await expect(deleteCachePattern(PATTERN)).rejects.toThrow("scan failed");
  });

  it("throws when Redis del fails", async () => {
    scan.mockResolvedValue([0, ["riskmodels:fundamentals_zarr:a"]]);
    del.mockRejectedValue(new Error("del failed"));
    await expect(deleteCachePattern(PATTERN)).rejects.toThrow("del failed");
  });

  it("returns the deleted count when Redis succeeds", async () => {
    scan
      .mockResolvedValueOnce(["7", ["riskmodels:fundamentals_zarr:a"]])
      .mockResolvedValueOnce([0, ["riskmodels:fundamentals_zarr:b"]]);
    del.mockResolvedValue(2);
    await expect(deleteCachePattern(PATTERN)).resolves.toBe(2);
    expect(del).toHaveBeenCalledWith(
      "riskmodels:fundamentals_zarr:a",
      "riskmodels:fundamentals_zarr:b",
    );
  });

  it("purge route returns 500 ok:false on Redis failure", async () => {
    scan.mockRejectedValue(new Error("redis down"));
    const res = await POST(request());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "redis down" });
  });

  it("purge route keeps the success shape on Redis success", async () => {
    scan.mockResolvedValue([0, ["riskmodels:fundamentals_zarr:a"]]);
    del.mockResolvedValue(1);
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, pattern: PATTERN, deleted: 1 });
  });
});
