/**
 * Agent surfaces can parameterize a render (G.54).
 *
 * Neither the MCP tool nor the chat tool accepted `params` at all before
 * 2026-08-02: an agent could ask for `top_holdings_erm_stacked` and always got
 * the default twelve rows, with no argument that would change it. That is what
 * made agent-driven artifact generation and inline artifact controls
 * impossible, so the property under test is end-to-end reachability — a param
 * named on the tool call must appear in the body render-svc receives, and two
 * calls differing only by a param must produce two distinct upstream requests.
 *
 * The upstream effect is verified separately against prod: `top_n=5` returned
 * 5 rows and `top_n=12` returned 10 for BW-FUND-S000009228 on 2026-08-02.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerRiskModelsRenderTool } from "@/lib/mcp/render-tool";
import {
  artifactRenderParamsSchema,
  compactParams,
  describeSlugParams,
} from "@/lib/artifacts/render-params-schema";
import { ARTIFACT_SLUG_PARAMS } from "@/lib/artifacts/render-client";

const originalFetch = global.fetch;
const originalEnv = process.env.RENDER_SVC_URL;

let sentBodies: Array<Record<string, unknown>> = [];

beforeEach(() => {
  sentBodies = [];
  process.env.RENDER_SVC_URL = "https://render.example.run.app";
  global.fetch = vi.fn(async (_url: unknown, init: unknown) => {
    const body = (init as RequestInit).body as string;
    sentBodies.push(JSON.parse(body) as Record<string, unknown>);
    return new Response(JSON.stringify({ slug: "x", n_holdings_rendered: 5 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalEnv === undefined) delete process.env.RENDER_SVC_URL;
  else process.env.RENDER_SVC_URL = originalEnv;
  vi.restoreAllMocks();
});

/** Minimal MCP server stand-in that captures the registered handler. */
function captureRenderTool() {
  let handler:
    | ((args: Record<string, unknown>) => Promise<unknown>)
    | null = null;
  let schema: Record<string, unknown> = {};
  registerRiskModelsRenderTool({
    registerTool: (
      _name: string,
      config: { inputSchema: Record<string, unknown> },
      fn: (args: Record<string, unknown>) => Promise<unknown>,
    ) => {
      schema = config.inputSchema;
      handler = fn;
    },
  } as never);
  if (!handler) throw new Error("render tool did not register");
  return { handler: handler as (a: Record<string, unknown>) => Promise<unknown>, schema };
}

describe("riskmodels_render_artifact params", () => {
  it("exposes a params argument at all", () => {
    const { schema } = captureRenderTool();
    expect(Object.keys(schema)).toContain("params");
  });

  it("forwards every declared param into the render-svc body", async () => {
    const { handler } = captureRenderTool();
    await handler({
      slug: "holdings_active_panel",
      subject_id: "BW-FUND-S000000008",
      params: {
        top_n: 5,
        peer_n: 8,
        window: "3y",
        sort_by: "residual",
        layers: "sector,residual",
        date: "2026-06-30",
        benchmark: "ff_own",
      },
    });
    expect(sentBodies[0].params).toEqual({
      top_n: 5,
      peer_n: 8,
      window: "3y",
      sort_by: "residual",
      layers: "sector,residual",
      date: "2026-06-30",
      benchmark: "ff_own",
    });
  });

  it("two calls differing only by a param produce two distinct requests", async () => {
    const { handler } = captureRenderTool();
    const base = {
      slug: "top_holdings_erm_stacked",
      subject_id: "BW-FUND-S000009228",
    };
    await handler({ ...base, params: { top_n: 5 } });
    await handler({ ...base, params: { top_n: 12 } });

    expect(sentBodies).toHaveLength(2);
    expect(sentBodies[0].params).toEqual({ top_n: 5 });
    expect(sentBodies[1].params).toEqual({ top_n: 12 });
    // Everything else is identical, so the param is the only thing that could
    // account for a difference in the response — which is what makes the live
    // 5-rows-vs-10-rows measurement attributable.
    expect({ ...sentBodies[0], params: null }).toEqual({
      ...sentBodies[1],
      params: null,
    });
  });

  it("omits the params key entirely when none are set", async () => {
    const { handler } = captureRenderTool();
    await handler({ slug: "entity_header", subject_id: "BW-FILER-0001067983" });
    expect(sentBodies[0]).not.toHaveProperty("params");
  });
});

describe("shared param schema", () => {
  it("drops undefined values so an empty object sends nothing", () => {
    expect(compactParams({ top_n: undefined })).toBeUndefined();
    expect(compactParams({})).toBeUndefined();
    expect(compactParams(undefined)).toBeUndefined();
    expect(compactParams({ top_n: 5, window: undefined })).toEqual({ top_n: 5 });
  });

  it("refuses out-of-range and malformed values locally", () => {
    for (const bad of [
      { top_n: 0 },
      { top_n: 51 },
      { peer_n: 0 },
      { window: "10y" },
      { layers: "Sector,Residual" },
      { date: "2026-8-2" },
      { sort_by: "" },
    ]) {
      expect(artifactRenderParamsSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(
        false,
      );
    }
  });

  it("accepts 3y and 5y — the windows no client could send", () => {
    expect(artifactRenderParamsSchema.safeParse({ window: "3y" }).success).toBe(true);
    expect(artifactRenderParamsSchema.safeParse({ window: "5y" }).success).toBe(true);
  });

  it("describes applicability from the slug map rather than prose", () => {
    const text = describeSlugParams();
    for (const [slug, keys] of Object.entries(ARTIFACT_SLUG_PARAMS)) {
      expect(text).toContain(`${slug}: ${keys.join("+")}`);
    }
    // The as_of / date distinction is stated where a model will read it.
    expect(text).toContain("NOT the request-level `as_of`");
  });
});
