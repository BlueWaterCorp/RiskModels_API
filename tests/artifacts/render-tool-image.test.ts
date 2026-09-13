import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderArtifact } from "@/lib/artifacts/render-client";
import { registerRiskModelsRenderTool } from "@/lib/mcp/render-tool";
import type { McpLikeServer, McpToolResult } from "@/lib/mcp/tools/riskmodels-tools";

vi.mock("@/lib/artifacts/render-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/artifacts/render-client")>()),
  renderArtifact: vi.fn(),
}));

// A tiny PNG exercises the actual MCP image envelope without starting a renderer.
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOncAAAAASUVORK5CYII=";
const provenance = {
  resolved_as_of: "2026-09-11",
  gcs_path: "gs://example/artifacts/NVDA/2026-09-11.png",
  receipt_id: "image-receipt",
};

function handler() {
  let captured!: (args: Record<string, unknown>) => Promise<McpToolResult>;
  registerRiskModelsRenderTool({
    registerTool: (_name, _config, callback) => { captured = callback; },
  } as McpLikeServer);
  return captured;
}

function textPayload(result: McpToolResult) {
  const content = result.content.find((item) => item.type === "text");
  if (!content || content.type !== "text") throw new Error("missing provenance text");
  return JSON.parse(content.text);
}

beforeEach(() => { vi.mocked(renderArtifact).mockReset(); });

describe("registry PNG delivery through MCP", () => {
  it("delivers original PNG bytes as an image with the resolved date, settings and receipt", async () => {
    vi.mocked(renderArtifact).mockResolvedValue({
      ok: true, ...provenance, format: "png",
      data: { format: "png", content_type: "image/png", base64: png, byte_length: Buffer.from(png, "base64").length },
    });
    const result = await handler()({
      slug: "l3_explained_risk_hbar", subject_id: "BW-STOCK-NVDA",
      as_of: "latest", format: "png", params: { layers: "subsector,residual" },
    });

    expect(CallToolResultSchema.safeParse(result).success).toBe(true);
    expect(result.content).toHaveLength(2);
    expect(result.content[1]).toEqual({ type: "image", data: png, mimeType: "image/png" });
    expect(textPayload(result)).toMatchObject({
      ...provenance, subject_id: "BW-STOCK-NVDA", params: { layers: "subsector,residual" },
      artifact: { content_type: "image/png", byte_length: Buffer.from(png, "base64").length, delivery: "mcp_image" },
    });
    expect(textPayload(result).artifact).not.toHaveProperty("base64");
    expect(textPayload(result).chart_instruction).toContain("do not redraw");
    expect(renderArtifact).toHaveBeenCalledOnce();
  });

  it.each([
    { content_type: "text/html", base64: png },
    { content_type: "image/png", base64: Buffer.from("upstream error").toString("base64") },
    { content_type: "image/png", base64: "" },
    { content_type: "image/png", base64: `${png}!` },
  ])("does not label an invalid upstream payload as a chart: $content_type", async (data) => {
    vi.mocked(renderArtifact).mockResolvedValue({ ok: true, ...provenance, format: "png", data });
    const result = await handler()({ slug: "l3_explained_risk_hbar", subject_id: "BW-STOCK-NVDA", format: "png" });
    expect(result.isError).toBe(true);
    expect(result.content.every((item) => item.type === "text")).toBe(true);
    expect(textPayload(result)).toMatchObject({ ...provenance, error: expect.stringContaining("invalid PNG") });
  });

  it.each(["json", "figure", "svg"] as const)("preserves the existing %s response contract", async (format) => {
    const data = format === "svg"
      ? { content_type: "image/svg+xml", base64: "PHN2Zy8+" }
      : { exposure: { subsector: -0.0072 }, data_as_of: "2026-09-11" };
    vi.mocked(renderArtifact).mockResolvedValue({ ok: true, ...provenance, format, data });
    const result = await handler()({ slug: "l3_explained_risk_hbar", subject_id: "BW-STOCK-NVDA", format });
    expect(result.content).toHaveLength(1);
    expect(textPayload(result)).toMatchObject({ ...provenance, format, artifact: data });
  });
});
