import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getCorsHeaders } from "@/lib/cors";
import { TickerSchema } from "@/lib/api/schemas";
import { z } from "zod";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import {
  computeFactorCorrelation,
  DEFAULT_MACRO_FACTORS,
} from "@/lib/risk/factor-correlation-service";
import { normalizeMacroFactorKeys } from "@/lib/risk/macro-factor-keys";
import { parseFormat, formatResponse, dictToRows } from "@/lib/api/format-response";

export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  factors: z
    .string()
    .nullish()
    .transform((s) => (s ? s.split(",").map((x) => x.trim().toLowerCase()) : undefined)),
  return_type: z.enum(["gross", "l1", "l2", "l3_residual"]).default("l3_residual"),
  window_days: z.coerce.number().int().min(20).max(2000).default(252),
  method: z.enum(["pearson", "spearman"]).default("pearson"),
});

export const GET = withBilling(
  async (request: NextRequest, context: BillingContext) => {
    const origin = request.headers.get("origin");
    try {
      const pathMatch = request.nextUrl.pathname.match(/\/api\/metrics\/([^/]+)\/correlation\/?$/);
      const rawTicker = pathMatch?.[1];
      const { searchParams } = new URL(request.url);

      if (!rawTicker) {
        return NextResponse.json(
          { error: "Invalid path", message: "Expected /api/metrics/{ticker}/correlation" },
          { status: 400, headers: getCorsHeaders(origin) },
        );
      }

      const tickerParse = TickerSchema.safeParse(rawTicker);
      if (!tickerParse.success) {
        return NextResponse.json(
          { error: "Invalid ticker", message: tickerParse.error.issues[0]?.message },
          { status: 400, headers: getCorsHeaders(origin) },
        );
      }

      const q = QuerySchema.safeParse({
        factors: searchParams.get("factors") ?? searchParams.get("factor") ?? undefined,
        return_type: searchParams.get("return_type") ?? undefined,
        window_days: searchParams.get("window_days") ?? undefined,
        method: searchParams.get("method") ?? undefined,
      });

      if (!q.success) {
        return NextResponse.json(
          { error: "Invalid query", message: q.error.issues[0]?.message },
          { status: 400, headers: getCorsHeaders(origin) },
        );
      }

      let factorList: string[] = [...DEFAULT_MACRO_FACTORS];
      if (q.data.factors?.length) {
        const { keys } = normalizeMacroFactorKeys(q.data.factors);
        if (keys.length === 0) {
          return NextResponse.json(
            {
              error: "Invalid factor key",
              message: `Unknown macro factor(s). Canonical keys: ${DEFAULT_MACRO_FACTORS.join(", ")}`,
            },
            { status: 400, headers: getCorsHeaders(origin) },
          );
        }
        factorList = [...keys];
      }

      const fetchStart = performance.now();
      const metadata = await getRiskMetadata();

      const result = await computeFactorCorrelation({
        ticker: tickerParse.data,
        factors: [...factorList],
        return_type: q.data.return_type,
        window_days: q.data.window_days,
        method: q.data.method,
      });

      if ("error" in result && "status" in result) {
        return NextResponse.json(
          { error: result.error },
          { status: result.status, headers: getCorsHeaders(origin) },
        );
      }

      const latency = Math.round(performance.now() - fetchStart);

      const format = parseFormat(searchParams, request.headers.get("accept"));
      if (format !== "json") {
        const corr = (result as unknown as Record<string, unknown>).correlations as Record<string, unknown>;
        const csvRows = dictToRows(corr, "factor");
        return formatResponse({
          rows: csvRows,
          format,
          filename: `${tickerParse.data}_correlation.csv`,
          extraHeaders: getCorsHeaders(origin) as Record<string, string>,
        });
      }

      const response = NextResponse.json({
        ...result,
        _metadata: buildMetadataBody(metadata),
        _agent: {
          latency_ms: latency,
          request_id: context.requestId,
        },
      });
      addMetadataHeaders(response, metadata);
      return response;
    } catch (err) {
      console.error("[correlation] GET failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        {
          error: "Correlation handler failed",
          message,
        },
        { status: 500, headers: getCorsHeaders(origin) },
      );
    }
  },
  { capabilityId: "factor-correlation" },
);
