/**
 * OpenBB app-polish surface: flagship app composition, cover images on every
 * app, and the agents.json widget-context feature flags (without which
 * Workspace shows "Context not available for this copilot" and never sends
 * pinned-widget context to /openbb/query).
 */
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { GET as agentsGET } from "@/app/openbb/agents.json/route";
import { APPS } from "@/app/openbb/_lib/apps";

describe("agents.json", () => {
  it("declares streaming + widget-context features", async () => {
    const res = await agentsGET(
      new NextRequest("https://riskmodels.app/openbb/agents.json"),
    );
    const agents = (await res.json()) as Record<
      string,
      { features: Record<string, boolean>; description: string; endpoints: { query: string } }
    >;
    const a = agents["riskmodels-analyst"];
    expect(a).toBeDefined();
    expect(a.features.streaming).toBe(true);
    expect(a.features["widget-dashboard-select"]).toBe(true);
    expect(a.features["widget-dashboard-search"]).toBe(true);
    expect(a.endpoints.query).toBe("https://riskmodels.app/openbb/query");
    // Orchestrator-routing keywords: fundamentals/cost-of-capital questions
    // must route here rather than fall through to the default OpenBB Copilot.
    for (const kw of ["fundamentals", "cost of capital", "point-in-time"]) {
      expect(a.description.toLowerCase()).toContain(kw);
    }
  });
});

describe("APPS composition", () => {
  it("leads with the flagship app carrying all five tabs", () => {
    const flagship = APPS[0];
    expect(flagship.name).toBe("RiskModels");
    expect(Object.keys(flagship.tabs)).toEqual([
      "overview",
      "fundamentals",
      "portfolio",
      "screener",
      "tearsheet",
    ]);
    const groupNames = (flagship.groups ?? []).map((g) => g.name);
    expect(groupNames).toEqual(["ticker", "positions", "source"]);
  });

  it("every app has a cover image", () => {
    for (const app of APPS) {
      const a = app as { name: string; img?: string; img_dark?: string; img_light?: string };
      for (const k of ["img", "img_dark", "img_light"] as const) {
        expect(a[k], `${app.name} ${k}`).toMatch(
          /^https:\/\/riskmodels\.app\/openbb-assets\/.+\.png$/,
        );
      }
    }
  });
});
