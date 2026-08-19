/**
 * OpenBB Workspace rejects a backend whose multi_file_viewer widgets omit
 * a params entry with roles: ["fileSelector"] (Connect Backend:
 * "Endpoint param with { roles: [\"fileSelector\"] } required").
 */
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { GET as widgetsGET } from "@/app/openbb/widgets.json/route";
import { GET as scaffoldOptionsGET } from "@/app/openbb/widgets/model-scaffold-options/route";

type WidgetParam = {
  paramName?: string;
  type?: string;
  roles?: string[];
  optionsEndpoint?: string;
  multiSelect?: boolean;
};

type WidgetDef = {
  type?: string;
  endpoint?: string;
  params?: WidgetParam[];
};

describe("openbb multi_file_viewer fileSelector", () => {
  it("every multi_file_viewer widget has a fileSelector param", async () => {
    const res = await widgetsGET(
      new NextRequest("http://localhost/openbb/widgets.json"),
    );
    const defs = (await res.json()) as Record<string, WidgetDef>;
    const viewers = Object.entries(defs).filter(([, w]) => w.type === "multi_file_viewer");
    expect(viewers.length).toBeGreaterThan(0);
    for (const [id, widget] of viewers) {
      const selector = (widget.params ?? []).find((p) =>
        p.roles?.includes("fileSelector"),
      );
      expect(selector, `${id} missing roles: [\"fileSelector\"]`).toBeDefined();
      expect(selector?.type, id).toBe("endpoint");
      expect(selector?.optionsEndpoint, id).toMatch(/^widgets\//);
      expect(selector?.multiSelect, id).toBe(true);
    }
  });

  it("model-scaffold optionsEndpoint returns a single xlsx choice", async () => {
    const res = await scaffoldOptionsGET(
      new NextRequest("http://localhost/openbb/widgets/model-scaffold-options?ticker=AAPL"),
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { label: string; value: string }[];
    expect(rows).toEqual([
      { label: "Valuation Model Scaffold", value: "model_scaffold" },
    ]);
  });
});
