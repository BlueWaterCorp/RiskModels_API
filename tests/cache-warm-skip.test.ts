import { describe, expect, it } from "vitest";
import { isSkippableCacheWarmPayload } from "@/lib/cache/redis";

describe("isSkippableCacheWarmPayload", () => {
  it("skips nullish, empty string, array, plain object", () => {
    expect(isSkippableCacheWarmPayload(null)).toBe(true);
    expect(isSkippableCacheWarmPayload(undefined)).toBe(true);
    expect(isSkippableCacheWarmPayload("")).toBe(true);
    expect(isSkippableCacheWarmPayload([])).toBe(true);
    expect(isSkippableCacheWarmPayload({})).toBe(true);
  });

  it("skips empty Map, Set, Uint8Array", () => {
    expect(isSkippableCacheWarmPayload(new Map())).toBe(true);
    expect(isSkippableCacheWarmPayload(new Set())).toBe(true);
    expect(isSkippableCacheWarmPayload(new Uint8Array(0))).toBe(true);
  });

  it("does not skip falsy numbers/booleans or non-empty payloads", () => {
    expect(isSkippableCacheWarmPayload(0)).toBe(false);
    expect(isSkippableCacheWarmPayload(false)).toBe(false);
    expect(isSkippableCacheWarmPayload("x")).toBe(false);
    expect(isSkippableCacheWarmPayload([1])).toBe(false);
    expect(isSkippableCacheWarmPayload({ a: 1 })).toBe(false);
    expect(isSkippableCacheWarmPayload(new Date())).toBe(false);
  });
});
