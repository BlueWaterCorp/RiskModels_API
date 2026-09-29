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
