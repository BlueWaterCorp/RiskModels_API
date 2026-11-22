import { describe, expect, it } from "vitest";
import {
  classifyChannel,
  firstTouchPatch,
  persistFirstTouchAttribution,
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

describe("firstTouchPatch keeps the first touch", () => {
  const utm = (over: Record<string, unknown> = {}) => ({
    utm_source: "google",
    utm_medium: "cpc",
    utm_campaign: "launch",
    utm_content: null,
    timestamp: "2026-11-01T10:00:00.000Z",
    referrer: "https://www.google.com/",
    landing_path: "/pricing",
    ...over,
  });

  it("records the real landing path, not the page that posted it", () => {
    const next = firstTouchPatch({}, { utm: utm(), landing_path: "/pricing" });
    expect(next.landing_path).toBe("/pricing");
    expect(next.referrer).toBe("https://www.google.com/");
  });

  it("a later write cannot replace landing path, referrer or any utm field", () => {
    const first = firstTouchPatch({}, { utm: utm(), landing_path: "/pricing" });
    const later = firstTouchPatch(first, {
      utm: utm({ utm_source: "newsletter", utm_medium: "email", utm_campaign: "later", referrer: "https://mail.example.com/", landing_path: "/get-key" }),
      landing_path: "/get-key",
      referrer: "https://mail.example.com/",
    });
    expect(later).toMatchObject({
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "launch",
      landing_path: "/pricing",
      referrer: "https://www.google.com/",
      channel: "ads",
    });
  });

  it("does not splice a later campaign into vacant utm fields of the first touch", () => {
    const first = firstTouchPatch({}, { utm: utm({ utm_medium: null, utm_campaign: null }) });
    const later = firstTouchPatch(first, { utm: utm({ utm_source: "other", utm_campaign: "later", utm_content: "ad2" }) });
    expect(later.utm_source).toBe("google");
    expect(later.utm_campaign).toBeUndefined();
    expect(later.utm_content).toBeUndefined();
  });

  it("drops a landing path or referrer that is not a path / http(s) URL", () => {
    const next = firstTouchPatch({}, { landing_path: "https://evil.com/", referrer: "javascript:alert(1)" });
    expect(next.landing_path).toBeUndefined();
    expect(next.referrer).toBeUndefined();
  });

  it("takes a referrer with no utm at all (organic landing)", () => {
    const next = firstTouchPatch({}, { landing_path: "/docs", referrer: "https://news.ycombinator.com/" });
    expect(next).toMatchObject({ landing_path: "/docs", referrer: "https://news.ycombinator.com/", channel: "organic" });
  });
});

/** Minimal agent_accounts stand-in: one row, select-chain + update-chain. */
function fakeAdmin(row: { id: string; created_at: string; signup_attribution: Record<string, unknown> }) {
  const state = { row, updated: null as Record<string, unknown> | null };
  const admin = {
    from: () => ({
      select: () => ({
        eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: state.row, error: null }) }) }) }),
      }),
      insert: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          state.updated = patch.signup_attribution as Record<string, unknown>;
          return { error: null };
        },
      }),
    }),
  };
  return { admin, state };
}

describe("persistFirstTouchAttribution prior_account", () => {
  it("a row created moments before by this sign-up is not a prior account", async () => {
    const { admin, state } = fakeAdmin({
      id: "a1", created_at: new Date(Date.now() - 400).toISOString(), signup_attribution: {},
    });
    await persistFirstTouchAttribution(admin, "u1", "x@example.com", { gclid: "TEST0929", landing_path: "/get-key" });
    expect(state.updated?.prior_account).toBeUndefined();
    expect(state.updated?.gclid).toBe("TEST0929");
    expect(state.updated?.channel).toBe("ads");
  });

  it("a row older than the sign-up window without attribution is a prior account", async () => {
    const { admin, state } = fakeAdmin({
      id: "a2", created_at: new Date(Date.now() - 2 * 86400_000).toISOString(), signup_attribution: {},
    });
    await persistFirstTouchAttribution(admin, "u2", null, { landing_path: "/get-key" });
    expect(state.updated?.prior_account).toBe(true);
  });
});
