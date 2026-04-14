import { describe, expect, it } from "vitest";
import {
  isDdSnapshotCacheHit,
  isPortfolioRiskSnapshotCacheHit,
  isRasterSnapshotCacheHit,
} from "@/lib/cache/snapshot-payload-guards";

describe("isDdSnapshotCacheHit", () => {
  it("accepts non-empty base64 and contentType", () => {
    expect(
      isDdSnapshotCacheHit({
        base64: "aGVsbG8=",
        contentType: "image/png",
      }),
    ).toBe(true);
  });

  it("rejects empty base64", () => {
    expect(
      isDdSnapshotCacheHit({ base64: "", contentType: "image/png" }),
    ).toBe(false);
  });

  it("rejects missing fields", () => {
    expect(isDdSnapshotCacheHit({})).toBe(false);
    expect(isDdSnapshotCacheHit(null)).toBe(false);
  });
});

describe("isRasterSnapshotCacheHit", () => {
  it("accepts non-empty base64", () => {
    expect(isRasterSnapshotCacheHit({ base64: "QQ==" })).toBe(true);
  });

  it("rejects empty base64 (would be a false HIT)", () => {
    expect(isRasterSnapshotCacheHit({ base64: "" })).toBe(false);
  });
});

describe("isPortfolioRiskSnapshotCacheHit", () => {
  it("accepts json with body", () => {
    expect(
      isPortfolioRiskSnapshotCacheHit({
        kind: "json",
        body: "{}",
        contentType: "application/json",
      }),
    ).toBe(true);
  });

  it("rejects json with empty body", () => {
    expect(
      isPortfolioRiskSnapshotCacheHit({
        kind: "json",
        body: "",
        contentType: "application/json",
      }),
    ).toBe(false);
  });

  it("accepts png/pdf with base64", () => {
    expect(
      isPortfolioRiskSnapshotCacheHit({ kind: "png", base64: "QQ==" }),
    ).toBe(true);
    expect(
      isPortfolioRiskSnapshotCacheHit({ kind: "pdf", base64: "QQ==" }),
    ).toBe(true);
  });
});
