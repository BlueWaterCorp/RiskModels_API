import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCorsHeaders } from "@/lib/cors";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import { renderArtifact } from "@/lib/artifacts/render-client";
import { artifactRenderParamsSchema, compactParams } from "@/lib/artifacts/render-params-schema";

/**
 * POST /api/artifacts/render — billed proxy to render-svc `POST /artifacts/render`.
 *
 * The `artifact-render` capability ($0.25 per render) described a route only
 * render-svc served, and the MCP tool `riskmodels_render_artifact` called
 * render-svc with the server's own Cloud Run identity, so renders were never
 * charged or rate-limited per key. The MCP tool now calls this route with the
 * caller's key, like every other tool. Failed renders (status >= 400) are not
 * charged.
 *
 * Body: { slug, subject_id, version?, as_of?, format?, subject_payload?, params? }.
 * Response: the render-client result, { ok, data, format, resolved_as_of,
 * gcs_path, receipt_id } on success or { ok: false, error, detail } with the
 * upstream status.
 */

const RenderBodySchema = z.object({
  slug: z.string().min(1),
  subject_id: z.string().min(1),
  version: z.string().optional(),
  as_of: z.string().optional(),
  format: z.enum(["json", "png", "svg", "figure"]).optional(),
  subject_payload: z.record(z.string(), z.unknown()).nullish(),
  params: artifactRenderParamsSchema.optional(),
});

export const POST = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const headers = getCorsHeaders(request.headers.get("origin"));

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400, headers });
    }
    const parsed = RenderBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid render request", detail: parsed.error.flatten() },
        { status: 400, headers },
      );
    }

    const { slug, subject_id, version, as_of, format, subject_payload, params } = parsed.data;
    const result = await renderArtifact({
      slug,
      subject_id,
      version,
      as_of,
      format,
      subject_payload: subject_payload ?? null,
      params: compactParams(params),
    });

    if (!result.ok) {
      const status = result.status && result.status >= 400 ? result.status : 502;
      return NextResponse.json(result, { status, headers });
    }
    return NextResponse.json(result, { status: 200, headers });
  },
  { capabilityId: "artifact-render" },
);

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(request.headers.get("origin")) });
}
