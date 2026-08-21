/**
 * OpenBB Connect QA — fail in CI before Minh's Add Authentication modal does.
 *
 * Protocol: every Connect-dialog failure becomes a named case here, then a
 * rule in app/openbb/_lib/connect-qa.ts. Cases so far:
 *   #194 type "pdf"
 *   #344 missing fileSelector
 *   #350 GET-only file endpoint (Workspace POSTs)
 *   #355 staleTime: 0
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { APPS } from "@/app/openbb/_lib/apps";
import {
  formatConnectIssues,
  validateApps,
  validateWidgetDefs,
} from "@/app/openbb/_lib/connect-qa";
import { isOpenBBOrigin, openbbCors } from "@/app/openbb/_lib/cors";
import { GET as widgetsGET, OPTIONS as widgetsOPTIONS } from "@/app/openbb/widgets.json/route";

type WidgetDef = {
  name: string;
  description: string;
  endpoint: string;
  type?: string;
  staleTime?: number;
  refetchInterval?: number | false | string;
  gridData?: { w: number; h: number };
  params?: Array<{
    paramName: string;
    type?: string;
    roles?: string[];
    optionsEndpoint?: string;
  }>;
};

async function liveWidgets(): Promise<Record<string, WidgetDef>> {
  const res = await widgetsGET(
    new NextRequest("http://localhost/openbb/widgets.json"),
  );
  return (await res.json()) as Record<string, WidgetDef>;
}

function tableWidget(overrides: Record<string, unknown> = {}): WidgetDef {
  return {
    name: "QA fixture",
    description: "Minimal valid table widget",
    endpoint: "widgets/metrics",
    type: "table",
    refetchInterval: 60000,
    gridData: { w: 20, h: 12 },
    params: [{ paramName: "ticker", type: "text" }],
    ...overrides,
  };
}

function fileWidget(overrides: Record<string, unknown> = {}): WidgetDef {
  return tableWidget({
    type: "multi_file_viewer",
    endpoint: "widgets/tearsheet",
    params: [
      { paramName: "ticker", type: "text" },
      {
        paramName: "file",
        type: "endpoint",
        optionsEndpoint: "widgets/tearsheet-options",
        roles: ["fileSelector"],
      },
    ],
    ...overrides,
  });
}

function openbbRoute(endpoint: string): string {
  return path.join(process.cwd(), "app/openbb", endpoint, "route.ts");
}

function routeExports(src: string): { GET: boolean; POST: boolean; OPTIONS: boolean } {
  const named = (verb: string) =>
    new RegExp(
      `export\\s+(async\\s+)?function\\s+${verb}\\b|export\\s+const\\s+${verb}\\s*=`,
    ).test(src);
  return {
    GET: named("GET"),
    POST: named("POST"),
    OPTIONS: named("OPTIONS"),
  };
}

describe("live widgets.json / apps.json (Connect payload)", () => {
  it("passes OpenBB widgets.json constraints", async () => {
    const defs = await liveWidgets();
    const issues = validateWidgetDefs(defs);
    expect(issues, formatConnectIssues(issues)).toEqual([]);
  });

  it("apps.json only references widgets that exist", async () => {
    const defs = await liveWidgets();
    const issues = validateApps(APPS, new Set(Object.keys(defs)));
    expect(issues, formatConnectIssues(issues)).toEqual([]);
  });

  it("every widget endpoint and optionsEndpoint has a route file", async () => {
    const defs = await liveWidgets();
    const missing: string[] = [];
    for (const [id, w] of Object.entries(defs)) {
      if (!existsSync(openbbRoute(w.endpoint))) {
        missing.push(`${id} endpoint ${w.endpoint}`);
      }
      for (const p of w.params ?? []) {
        if (typeof p.optionsEndpoint === "string" && !existsSync(openbbRoute(p.optionsEndpoint))) {
          missing.push(`${id} optionsEndpoint ${p.optionsEndpoint}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("multi_file_viewer endpoints export GET + POST + OPTIONS (#350)", async () => {
    const defs = await liveWidgets();
    const bad: string[] = [];
    for (const [id, w] of Object.entries(defs)) {
      if (w.type !== "multi_file_viewer") continue;
      const src = readFileSync(openbbRoute(w.endpoint), "utf8");
      const exp = routeExports(src);
      if (!exp.GET || !exp.POST || !exp.OPTIONS) {
        bad.push(`${id}: GET=${exp.GET} POST=${exp.POST} OPTIONS=${exp.OPTIONS}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("widget routes all export OPTIONS (CORS preflight)", async () => {
    const defs = await liveWidgets();
    const bad: string[] = [];
    for (const [id, w] of Object.entries(defs)) {
      const src = readFileSync(openbbRoute(w.endpoint), "utf8");
      if (!routeExports(src).OPTIONS) bad.push(id);
    }
    expect(bad).toEqual([]);
  });
});

describe("Connect regression cases (Minh)", () => {
  it("#355 staleTime: 0 is Invalid input", () => {
    const issues = validateWidgetDefs({ rm_tearsheet: fileWidget({ staleTime: 0 }) });
    expect(issues.some((i) => i.field === "staleTime" && i.message === "Invalid input")).toBe(
      true,
    );
  });

  it("#194 type pdf is not a widgets.json type", () => {
    const issues = validateWidgetDefs({ rm_snapshot: tableWidget({ type: "pdf" }) });
    expect(issues.some((i) => i.field === "type" && /pdf/.test(i.message))).toBe(true);
  });

  it("#344 multi_file_viewer without fileSelector fails", () => {
    const issues = validateWidgetDefs({
      rm_model_scaffold: fileWidget({
        params: [{ paramName: "ticker", type: "text" }],
      }),
    });
    expect(issues.some((i) => /fileSelector/.test(i.message))).toBe(true);
  });

  it("refetchInterval below 1000 ms is Invalid input", () => {
    const issues = validateWidgetDefs({ rm_ok: tableWidget({ refetchInterval: 0 }) });
    expect(issues.some((i) => i.field === "refetchInterval")).toBe(true);
  });

  it("a valid file widget has no issues", () => {
    expect(validateWidgetDefs({ rm_tearsheet: fileWidget() })).toEqual([]);
  });
});

describe("CORS (Connect preflight)", () => {
  it("allows the origins in OpenBB's backend contract", () => {
    for (const origin of [
      "https://pro.openbb.co",
      "https://pro.openbb.dev",
      "http://localhost:1420",
    ]) {
      expect(isOpenBBOrigin(origin), origin).toBe(true);
    }
  });

  it("widgets.json OPTIONS echoes an OpenBB Origin", async () => {
    const req = new NextRequest("http://localhost/openbb/widgets.json", {
      method: "OPTIONS",
      headers: { origin: "https://pro.openbb.co" },
    });
    const res = await widgetsOPTIONS(req);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://pro.openbb.co");
    expect(res.headers.get("access-control-allow-headers")).toMatch(/X-API-KEY/i);
  });

  it("openbbCors never falls back to a mismatched origin", () => {
    const headers = openbbCors({
      headers: { get: (n: string) => (n === "origin" ? "https://evil.example" : null) },
    });
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});
