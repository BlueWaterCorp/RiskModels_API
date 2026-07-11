import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/cache/redis", () => ({
  deleteCachePattern: vi.fn(),
}));

import { deleteCachePattern } from "@/lib/cache/redis";
import { POST } from "@/app/api/admin/cache/fundamentals/route";

const URL = "http://localhost/api/admin/cache/fundamentals";

function request(auth?: string): NextRequest {
  return new NextRequest(URL, {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });
}

describe("POST /api/admin/cache/fundamentals", () => {
  beforeEach(() => {
    vi.mocked(deleteCachePattern).mockReset();
    process.env.CRON_SECRET = "test-secret";
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("rejects missing or wrong bearer token", async () => {
    for (const auth of [undefined, "Bearer wrong", "test-secret"]) {
      const res = await POST(request(auth));
      expect(res.status).toBe(401);
    }
    expect(deleteCachePattern).not.toHaveBeenCalled();
  });

  it("rejects when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(request("Bearer test-secret"));
    expect(res.status).toBe(401);
    expect(deleteCachePattern).not.toHaveBeenCalled();
  });

  it("purges the fundamentals_zarr namespace and reports the count", async () => {
    vi.mocked(deleteCachePattern).mockResolvedValueOnce(42);
    const res = await POST(request("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      pattern: "riskmodels:fundamentals_zarr:*",
      deleted: 42,
    });
    expect(deleteCachePattern).toHaveBeenCalledWith(
      "riskmodels:fundamentals_zarr:*",
    );
  });

  it("returns 500 with the error message on redis failure", async () => {
    vi.mocked(deleteCachePattern).mockRejectedValueOnce(new Error("redis down"));
    const res = await POST(request("Bearer test-secret"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "redis down" });
  });
});
