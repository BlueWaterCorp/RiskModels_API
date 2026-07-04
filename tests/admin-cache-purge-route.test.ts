import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/cache/redis", () => ({
  deleteCachePattern: vi.fn(),
}));

import { deleteCachePattern } from "@/lib/cache/redis";
import { POST } from "@/app/api/admin/cache/funds/route";

const URL = "http://localhost/api/admin/cache/funds";

function request(auth?: string): NextRequest {
  return new NextRequest(URL, {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });
}

describe("POST /api/admin/cache/funds", () => {
  beforeEach(() => {
    vi.mocked(deleteCachePattern).mockReset();
    process.env.CRON_SECRET = "test-secret";
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("rejects missing or wrong bearer token", async () => {
    expect((await POST(request())).status).toBe(401);
    expect((await POST(request("Bearer wrong"))).status).toBe(401);
    expect(vi.mocked(deleteCachePattern)).not.toHaveBeenCalled();
  });

  it("rejects everything when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    expect((await POST(request("Bearer test-secret"))).status).toBe(401);
  });

  it("purges the funds_zarr namespace and reports the count", async () => {
    vi.mocked(deleteCachePattern).mockResolvedValue(42);
    const res = await POST(request("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      pattern: "riskmodels:funds_zarr:*",
      deleted: 42,
    });
    expect(vi.mocked(deleteCachePattern)).toHaveBeenCalledWith(
      "riskmodels:funds_zarr:*",
    );
  });

  it("returns 500 when the purge throws", async () => {
    vi.mocked(deleteCachePattern).mockRejectedValue(new Error("scan failed"));
    const res = await POST(request("Bearer test-secret"));
    expect(res.status).toBe(500);
    expect((await res.json()).ok).toBe(false);
  });
});
