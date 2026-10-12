import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { GET, HEAD } from "@/app/api/data/risk-calendar/route";
import { RISK_CALENDAR_RETIRED_BODY } from "@/lib/api/retired-endpoints";
import { CHAT_TOOLS, CHAT_TOOLS_REGISTRY, TOOL_MAP } from "@/lib/chat/tools";
import { executeToolCalls } from "@/lib/chat/tool-executor";

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
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    const body = await res.json();
    expect(body).toEqual(RISK_CALENDAR_RETIRED_BODY);
    expect(body).toMatchObject({ error: "risk_calendar_retired", code: 410 });
    expect(body.message).toContain("/api/data/filing-calendar");
  });

  it("HEAD answers 410 with no body and the same headers as GET", async () => {
    const head = await HEAD();
    const get = await GET();
    expect(head.status).toBe(410);
    expect(await head.text()).toBe("");
    expect(head.headers.get("cache-control")).toBe(get.headers.get("cache-control"));
    expect(head.headers.get("content-type")).toContain("application/json");
  });

  it("the chat tool set no longer exposes get_risk_calendar", () => {
    expect(CHAT_TOOLS_REGISTRY.map((t) => t.name)).not.toContain("get_risk_calendar");
    expect(Object.prototype.hasOwnProperty.call(TOOL_MAP, "get_risk_calendar")).toBe(false);
    expect(
      CHAT_TOOLS.some(
        (t) => (t as { function?: { name?: string } }).function?.name === "get_risk_calendar",
      ),
    ).toBe(false);
  });

  it("the risk_events service is deleted", () => {
    expect(existsSync(path.resolve(__dirname, "../lib/risk/risk-calendar-service.ts"))).toBe(false);
  });

  it("a stale get_risk_calendar call gets the executor's free unknown-tool answer (accepted)", async () => {
    const [r] = await executeToolCalls(
      [{ id: "t1", type: "function", function: { name: "get_risk_calendar", arguments: "{}" } }] as never,
      { userId: "u", requestId: "r", skipBilling: true },
    );
    expect(r?.error).toBe("Unknown tool: get_risk_calendar");
    expect(r?.cost_usd).toBe(0);
  });

  it("no code outside the retirement allowlist names the tool or reads risk_events", () => {
    const root = path.resolve(__dirname, "..");
    const allow = new Set([
      "app/api/data/risk-calendar/route.ts",
      "lib/api/retired-endpoints.ts",
      "tests/risk-calendar-retired.test.ts",
    ]);
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (["node_modules", ".next", ".git", "dist", "public"].includes(name)) continue;
        const full = path.join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) walk(full);
        else if (/\.(ts|tsx|js|mjs|py|json|md|mdx)$/.test(name)) {
          const rel = path.relative(root, full).split(path.sep).join("/");
          if (allow.has(rel) || rel.startsWith("mcp/data/") || rel === "OPENAPI_SPEC.yaml") continue;
          const text = readFileSync(full, "utf8");
          if (/get_risk_calendar|risk-calendar-service|from\(["']risk_events["']\)/.test(text)) hits.push(rel);
        }
      }
    };
    for (const d of ["app", "lib", "components", "mcp", "sdk", "cli", "content", "docs", "claude-plugin", "packages", "tests"]) {
      const full = path.join(root, d);
      if (existsSync(full)) walk(full);
    }
    expect(hits).toEqual([]);
  });
});
