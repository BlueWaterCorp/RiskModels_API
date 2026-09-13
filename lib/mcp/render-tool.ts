import { z } from "zod";
import {
  renderArtifact,
  WIRED_ARTIFACT_RENDER_MATRIX,
} from "@/lib/artifacts/render-client";
import {
  artifactRenderParamsSchema,
  compactParams,
  describeSlugParams,
} from "@/lib/artifacts/render-params-schema";
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
        "Render a deterministic registry artifact (stock, multi-ticker watchlist, fund, filer, or client portfolio). Use format png to display the original chart: returns MCP image content with dated provenance and receipt, not a chart to redraw. JSON returns chart/table/narrative data; SVG returns a base64 export. Stock subjects are BW-STOCK-{TICKER}, formed from the ticker with no lookup. To put several named tickers on ONE shared risk-composition axis, use watchlist_er_stacked with subject_id BW-STOCK-WATCHLIST and subject_payload { tickers: [...] } (up to 12) — the whole set is resolved to ONE shared date (the oldest latest-close in the set, or an explicit as_of), so it is a date-aligned comparison. Present it as of resolved_as_of, never today's date. Read as_of_alignment on the JSON payload: if excluded is non-empty, those tickers had no data at that date and are NOT on the chart — name them. Same contract as riskmodels.net workspace fetchArtifact.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        slug: z
          .string()
          .min(1)
          .describe(
            "Artifact slug — stock subjects: l3_explained_risk_hbar, " +
              "hedge_notionals_hbar, hedge_depth_retained, watchlist_er_stacked; " +
              "fund/filer subjects: top_holdings_erm_stacked, entity_header, " +
              "risk_summary_panel",
          ),
        version: z.string().optional().describe("Version tag, default v1"),
        subject_id: z
          .string()
          .min(1)
          .describe(
            "BW-STOCK-… (e.g. BW-STOCK-BAC), BW-STOCK-WATCHLIST (multi-ticker; " +
              "pass subject_payload.tickers), BW-FUND-…, BW-FILER-…, or " +
              "BW-PORTFOLIO-…",
          ),
        as_of: z
          .string()
          .optional()
          .describe(
            "YYYY-MM-DD or latest. Cohort subjects (BW-COHORT-*) resolve latest to " +
              "the newest pre-rendered vintage; filers need an explicit filing period " +
              "end — GET /api/artifacts/as-of?slug=&subject_id= (riskmodels_call_endpoint) " +
              "lists the dates that exist.",
          ),
        format: z
          .enum(["json", "png", "svg", "figure"])
          .optional()
          .describe(
            "Output format, default json. 'png' = original chart as MCP image content with provenance. 'figure' = Plotly figure spec for " +
              "client-side rendering (Plotly-backed slugs only).",
          ),
        subject_payload: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            "Required for BW-STOCK-WATCHLIST: { tickers: [\"BAC\", \"IBM\"] } — " +
              "1 to 12 US equity tickers. Required for BW-PORTFOLIO-*: " +
              "{ positions: [{ ticker, weight }] }",
          ),
        params: artifactRenderParamsSchema
          .optional()
          .describe(describeSlugParams()),
      },
    },
    async ({ slug, version, subject_id, as_of, format, subject_payload, params }) => {
      try {
        const result = await renderArtifact({
          slug,
          version,
          subject_id,
          as_of,
          format,
          subject_payload: subject_payload ?? null,
          params: compactParams(params),
        });
        if (!result.ok) {
          return textResult({
            error: result.error,
            status: result.status,
            detail: result.detail,
            wired_slugs: WIRED_ARTIFACT_RENDER_MATRIX,
            capability_endpoint:
              "GET /api/artifacts/capability?subject_kind=… — the full verified " +
              "(slug, subject_kind) table plus per-slug param applicability.",
          });
        }
        const metadata = {
          slug,
          subject_id,
          // Echoed so a caller can see which knobs were actually sent — a
          // render that silently ignored a param is indistinguishable from one
          // that honored it otherwise.
          params: compactParams(params) ?? null,
          format: result.format,
          resolved_as_of: result.resolved_as_of,
          gcs_path: result.gcs_path,
          receipt_id: result.receipt_id,
        };
        if (result.format === "png") {
          const artifact = result.data as {
            content_type?: unknown;
            base64?: unknown;
          } | null;
          const mimeType = typeof artifact?.content_type === "string"
            ? artifact.content_type.split(";")[0].trim().toLowerCase()
            : "";
          const base64 = typeof artifact?.base64 === "string" ? artifact.base64 : "";
          const bytes = Buffer.from(base64, "base64");
          const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
          if (
            mimeType !== "image/png" ||
            !bytes.subarray(0, 8).equals(pngSignature) ||
            bytes.toString("base64") !== base64
          ) {
            return {
              ...textResult({ ...metadata, error: "Render service returned an invalid PNG artifact." }),
              isError: true,
            };
          }
          return {
            content: [
              ...textResult({
                ...metadata,
                chart_instruction:
                  "Display the supplied RiskModels image directly; do not redraw it. " +
                  "Retain resolved_as_of and receipt_id when explaining the chart. " +
                  "Request format json for exact numerical values.",
                artifact: {
                  format: "png",
                  content_type: mimeType,
                  byte_length: bytes.length,
                  delivery: "mcp_image",
                },
              }).content,
              { type: "image" as const, data: base64, mimeType: "image/png" as const },
            ],
          };
        }
        return textResult({ ...metadata, artifact: result.data });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
