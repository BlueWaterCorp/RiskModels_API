import { z } from "zod";
import {
  renderArtifact,
  WIRED_ARTIFACT_RENDER_MATRIX,
} from "@/lib/artifacts/render-client";
import {
  textResult,
  errorResult,
  type McpLikeServer,
} from "@/lib/mcp/tools/riskmodels-tools";

/**
 * Hosted-only MCP tool — deliberately kept OUT of `lib/mcp/tools/`.
 *
 * The standalone stdio build (`mcp/tsconfig.json` includes
 * `../lib/mcp/tools/**`) must NOT compile this file: `render-client` →
 * `gcp-id-token` authenticates to GCP Cloud Run, which a public
 * `npx @riskmodels/mcp` user has no credentials for. So `riskmodels_render_artifact`
 * is registered only by the hosted server (`lib/mcp/server.ts`); the stdio
 * server (`mcp/src/server.ts`) never imports this module.
 */
export function registerRiskModelsRenderTool(server: McpLikeServer): void {
  server.registerTool(
    "riskmodels_render_artifact",
    {
      title: "RiskModels Artifact Registry Render",
      description:
        "Render a deterministic registry artifact (fund, filer, or client portfolio). Returns JSON chart/table/narrative or base64 PNG/SVG. Same contract as riskmodels.net workspace fetchArtifact.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        slug: z.string().min(1).describe("Artifact slug, e.g. top_holdings_erm_stacked"),
        version: z.string().optional().describe("Version tag, default v1"),
        subject_id: z
          .string()
          .min(1)
          .describe("BW-FUND-…, BW-FILER-…, or BW-PORTFOLIO-…"),
        as_of: z
          .string()
          .optional()
          .describe("YYYY-MM-DD or latest; filers need explicit filing period end"),
        format: z
          .enum(["json", "png", "svg", "figure"])
          .optional()
          .describe(
            "Output format, default json. 'figure' = Plotly figure spec for " +
              "client-side rendering (Plotly-backed slugs only).",
          ),
        subject_payload: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Required for BW-PORTFOLIO-*: { positions: [{ ticker, weight }] }"),
      },
    },
    async ({ slug, version, subject_id, as_of, format, subject_payload }) => {
      try {
        const result = await renderArtifact({
          slug,
          version,
          subject_id,
          as_of,
          format,
          subject_payload: subject_payload ?? null,
        });
        if (!result.ok) {
          return textResult({
            error: result.error,
            status: result.status,
            detail: result.detail,
            wired_slugs: WIRED_ARTIFACT_RENDER_MATRIX,
          });
        }
        return textResult({
          slug,
          subject_id,
          format: result.format,
          resolved_as_of: result.resolved_as_of,
          gcs_path: result.gcs_path,
          receipt_id: result.receipt_id,
          artifact: result.data,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
