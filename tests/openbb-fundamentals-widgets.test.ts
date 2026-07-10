/**
 * OpenBB fundamentals surface (E.23 g): widgets.json / apps.json consistency
 * plus the get_fundamentals chat-tool registry entry. Structural tests only —
 * the widget data routes are upstream passthroughs exercised live.
 */
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The chat tool registry imports GCS-backed DAL modules transitively; mock the
// I/O entry points so importing the registry stays pure.
vi.mock("@/lib/dal/fundamentals-zarr-reader", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/dal/fundamentals-zarr-reader")>();
  return { ...actual, getFundamentalsForTicker: vi.fn() };
});

import { GET as widgetsGET } from "@/app/openbb/widgets.json/route";
import { APPS } from "@/app/openbb/_lib/apps";
import { CHAT_TOOLS_REGISTRY } from "@/lib/chat/tools";

const FUNDAMENTALS_WIDGET_IDS = [
  "rm_fundamentals_history",
  "rm_fundamentals_ratios",
  "rm_cost_of_capital",
  "rm_wacc_grid",
];

async function fetchWidgetDefs(): Promise<Record<string, { endpoint: string }>> {
  const res = await widgetsGET(
    new NextRequest("http://localhost/openbb/widgets.json"),
  );
  return (await res.json()) as Record<string, { endpoint: string }>;
}

describe("openbb fundamentals widgets", () => {
  it("registers all four fundamentals widget defs", async () => {
    const defs = await fetchWidgetDefs();
    for (const id of FUNDAMENTALS_WIDGET_IDS) {
      expect(defs[id], id).toBeDefined();
      expect(defs[id].endpoint.startsWith("widgets/")).toBe(true);
    }
  });

  it("every widget id referenced by APPS layouts and groups exists in widgets.json", async () => {
    const defs = await fetchWidgetDefs();
    for (const app of APPS) {
      for (const tab of Object.values(app.tabs)) {
        for (const item of tab.layout) {
          expect(defs[item.i], `${app.name} → ${item.i}`).toBeDefined();
        }
      }
      for (const group of app.groups ?? []) {
        for (const id of group.widgetIds) {
          expect(defs[id], `${app.name} group ${group.name} → ${id}`).toBeDefined();
        }
      }
    }
  });

  it("Single-Name Risk app carries the Fundamentals tab under the ticker param group", () => {
    const app = APPS.find((a) => a.name.includes("Single-Name Risk"))!;
    expect(app.tabs).toHaveProperty("fundamentals");
    const group = (app.groups ?? []).find((g) => g.paramName === "ticker")!;
    for (const id of FUNDAMENTALS_WIDGET_IDS) {
      expect(group.widgetIds, id).toContain(id);
    }
  });
});

describe("get_fundamentals chat tool", () => {
  const def = CHAT_TOOLS_REGISTRY.find((t) => t.name === "get_fundamentals");

  it("is registered and billed against the fundamentals capability", () => {
    expect(def).toBeDefined();
    expect(def!.capabilityId).toBe("fundamentals");
  });

  it("applies defaults and bounds on args", () => {
    const parsed = def!.argSchema.parse({ ticker: "AAPL" }) as Record<
      string,
      unknown
    >;
    expect(parsed.periods).toBe(4);
    expect(parsed.erp).toBe(0.05);
    expect(parsed.rf_tenor).toBe("10y");
    expect(() => def!.argSchema.parse({ ticker: "AAPL", periods: 41 })).toThrow();
    expect(() =>
      def!.argSchema.parse({ ticker: "AAPL", as_of: "07/04/2026" }),
    ).toThrow();
    expect(() =>
      def!.argSchema.parse({ ticker: "AAPL", rf_tenor: "7y" }),
    ).toThrow();
  });
});
