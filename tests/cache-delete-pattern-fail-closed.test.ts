/**
 * ERM3-97: the fundamentals cache purge must fail closed. A failed Redis
 * scan or delete has to reach the route as a non-2xx response, not as
 * `ok: true` with a count. Upstash is mocked; no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

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
import { POST as purgeFundamentals } from "@/app/api/admin/cache/fundamentals/route";
import { POST as purgeFunds } from "@/app/api/admin/cache/funds/route";

const PATTERN = "riskmodels:fundamentals_zarr:*";

function request(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
  });
}

beforeEach(() => {
  scan.mockReset();
  del.mockReset();
  process.env.CRON_SECRET = "test-secret";
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  vi.restoreAllMocks();
});

describe("deleteCachePattern with Redis configured", () => {
  it("returns the count across scan pages on success", async () => {
    scan
      .mockResolvedValueOnce(["7", ["a", "b"]])
      .mockResolvedValueOnce(["0", ["c"]]);
    del.mockResolvedValueOnce(3);
    await expect(deleteCachePattern(PATTERN, { failOnError: true })).resolves.toBe(3);
    expect(del).toHaveBeenCalledWith("a", "b", "c");
  });

  it("throws on a scan failure when failOnError is set", async () => {
    scan.mockRejectedValueOnce(new Error("scan failed"));
    await expect(deleteCachePattern(PATTERN, { failOnError: true })).rejects.toThrow(
      "scan failed",
    );
    expect(del).not.toHaveBeenCalled();
  });

  it("throws on a delete failure when failOnError is set", async () => {
    scan.mockResolvedValueOnce(["0", ["a"]]);
    del.mockRejectedValueOnce(new Error("del failed"));
    await expect(deleteCachePattern(PATTERN, { failOnError: true })).rejects.toThrow(
      "del failed",
    );
  });

  it("keeps the best-effort default: a scan failure is swallowed", async () => {
    scan.mockRejectedValueOnce(new Error("scan failed"));
    await expect(deleteCachePattern(PATTERN)).resolves.toBe(0);
  });
});

describe("purge routes over the real cache module", () => {
  it("fundamentals: a scan failure returns 500 with an error body", async () => {
    scan.mockRejectedValueOnce(new Error("scan failed"));
    const res = await purgeFundamentals(request("/api/admin/cache/fundamentals"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "scan failed" });
  });

  it("fundamentals: a delete failure returns 500 with an error body", async () => {
    scan.mockResolvedValueOnce(["0", ["riskmodels:fundamentals_zarr:AAPL"]]);
    del.mockRejectedValueOnce(new Error("del failed"));
    const res = await purgeFundamentals(request("/api/admin/cache/fundamentals"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "del failed" });
  });

  it("fundamentals: success returns 200 with the count", async () => {
    scan.mockResolvedValueOnce([
      "0",
      ["riskmodels:fundamentals_zarr:AAPL", "riskmodels:fundamentals_zarr:MSFT"],
    ]);
    del.mockResolvedValueOnce(2);
    const res = await purgeFundamentals(request("/api/admin/cache/fundamentals"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, pattern: PATTERN, deleted: 2 });
  });

  it("funds: stays best-effort, a scan failure still returns 200", async () => {
    scan.mockRejectedValueOnce(new Error("scan failed"));
    const res = await purgeFunds(request("/api/admin/cache/funds"));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});
