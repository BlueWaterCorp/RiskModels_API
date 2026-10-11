import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { GET, HEAD } from "@/app/api/data/risk-calendar/route";
import { RISK_CALENDAR_RETIRED_BODY } from "@/lib/api/retired-endpoints";
import { CHAT_TOOLS, CHAT_TOOLS_REGISTRY, TOOL_MAP } from "@/lib/chat/tools";

/**
 * The Risk Calendar (T.6) is retired: the route answers a documented 410
 * Gone, the chat tool is gone, and the service that read `risk_events` is
 * deleted. The `risk_events` rows themselves are exported and deleted after
 * merge (apply plan), not by this code.
 */
describe("Risk Calendar retirement", () => {
  it("GET /api/data/risk-calendar answers 410 with error code risk_calendar_retired", async () => {
    const res = await GET();
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body).toEqual(RISK_CALENDAR_RETIRED_BODY);
    expect(body).toMatchObject({ error: "risk_calendar_retired", code: 410 });
    expect(body.message).toContain("/api/data/filing-calendar");
  });

  it("HEAD answers 410 with no body", async () => {
    const res = await HEAD();
    expect(res.status).toBe(410);
    expect(await res.text()).toBe("");
  });

  it("the chat tool set no longer exposes get_risk_calendar", () => {
    expect(CHAT_TOOLS_REGISTRY.map((t) => t.name)).not.toContain("get_risk_calendar");
    expect(TOOL_MAP.get_risk_calendar).toBeUndefined();
    expect(
      CHAT_TOOLS.some(
        (t) => (t as { function?: { name?: string } }).function?.name === "get_risk_calendar",
      ),
    ).toBe(false);
  });

  it("the risk_events service is deleted", () => {
    expect(existsSync(path.resolve(__dirname, "../lib/risk/risk-calendar-service.ts"))).toBe(false);
  });
});
