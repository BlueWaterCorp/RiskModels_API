import { CHART_WIDGET_PNG_META_KEY, CHART_WIDGET_URI, registerChartWidget } from "@/lib/mcp/chart-widget";
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
  toolErrorResult,
  READ_ONLY_TOOL_ANNOTATIONS,
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
  registerChartWidget(server);
  server.registerTool(
    "riskmodels_render_artifact",
    {
      title: "RiskModels Artifact Registry Render",
      description:
        "Renders a chart or table from the RiskModels artifact registry for a stock (BW-STOCK-{TICKER}), a watchlist of up to 12 tickers (BW-STOCK-WATCHLIST with subject_payload.tickers), a mutual fund (BW-FUND-…), a 13F filer (BW-FILER-…) or a client portfolio (BW-PORTFOLIO-… with subject_payload.positions). format json returns the chart's data, table and narrative; png returns the rendered image as MCP image content with its resolved date and receipt id; svg returns a base64 SVG; figure returns a Plotly figure spec (Plotly-backed slugs only). risk_comparison puts several tickers on one shared risk-composition axis. A watchlist is resolved to ONE shared date (the oldest latest close in the set, or an explicit as_of), returned as resolved_as_of; tickers with no data on that date are listed in as_of_alignment.excluded. cumulative_return_paths accepts params.window (3m, 6m, 1y, 2y or max; default 1y); its fitted factor paths are not ETF returns.",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      _meta: {
        ui: { resourceUri: CHART_WIDGET_URI },
        "openai/outputTemplate": CHART_WIDGET_URI,
        "openai/toolInvocation/invoking": "Rendering RiskModels chart…",
        "openai/toolInvocation/invoked": "RiskModels result ready",
      },
      inputSchema: {
        slug: z
          .string()
          .min(1)
          .describe(
            "Artifact slug — stock subjects: l3_explained_risk_hbar, " +
              "hedge_notionals_hbar, hedge_depth_retained, risk_comparison, watchlist_er_stacked, cumulative_return_paths; " +
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
              "end; GET /api/artifacts/as-of?slug=&subject_id= lists the dates that exist.",
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
          return toolErrorResult({
            error: result.error,
            status: result.status,
            detail: result.detail,
            wired_slugs: WIRED_ARTIFACT_RENDER_MATRIX,
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
              ...toolErrorResult({ ...metadata, error: "Render service returned an invalid PNG artifact." }),
            };
          }
          return {
            content: [
              ...textResult({
                ...metadata,
                artifact: {
                  format: "png",
                  content_type: mimeType,
                  byte_length: bytes.length,
                  delivery: "mcp_image",
                },
              }).content,
              { type: "image" as const, data: base64, mimeType: "image/png" as const },
            ],
            // For the MCP App: hosts may not forward image blocks to the widget.
            // _meta reaches the app without entering the model's context.
            _meta: { [CHART_WIDGET_PNG_META_KEY]: base64 },
          };
        }
        return textResult({ ...metadata, artifact: result.data });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
