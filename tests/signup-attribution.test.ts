import { describe, expect, it } from "vitest";
import {
  classifyChannel,
  firstTouchPatch,
} from "@/lib/agent/signup-attribution";

describe("classifyChannel", () => {
  it("treats gclid as ads", () => {
    expect(classifyChannel({ gclid: "abc" })).toBe("ads");
  });

  it("treats cpc medium as ads", () => {
    expect(
      classifyChannel({ utm_source: "google", utm_medium: "cpc" }),
    ).toBe("ads");
  });

  it("treats missing paid markers as organic", () => {
    expect(classifyChannel({ utm_source: "newsletter" })).toBe("organic");
    expect(classifyChannel({})).toBe("organic");
  });
});

describe("firstTouchPatch", () => {
  it("does not overwrite an existing gclid", () => {
    const next = firstTouchPatch(
      { gclid: "first", gclid_at: "2026-01-01T00:00:00.000Z" },
      { gclid: "second" },
    );
    expect(next.gclid).toBe("first");
  });

  it("fills channel from gclid on first write", () => {
    const next = firstTouchPatch({}, { gclid: "Ea1-b" });
    expect(next.channel).toBe("ads");
    expect(next.gclid).toBe("Ea1-b");
  });

  it("fills organic when there is no paid marker", () => {
    const next = firstTouchPatch(
      {},
      {
        utm: {
          utm_source: "newsletter",
          utm_medium: null,
          utm_campaign: null,
          utm_content: null,
          timestamp: "2026-08-16T00:00:00.000Z",
          referrer: null,
          landing_path: "/",
        },
      },
    );
    expect(next.channel).toBe("organic");
    expect(next.utm_source).toBe("newsletter");
  });
});
