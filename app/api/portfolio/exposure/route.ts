/**
 * POST /api/portfolio/exposure — signed long/short book exposure and L3 risk.
 *
 * Takes signed dollar positions (short < 0, up to 1000) and returns beta-dollars,
 * the ETF hedge trades at L1/L2/L3, and an L3 risk split: systematic risk from
 * the book's raw-ETF exposure × ETF covariance, plus a diagonal approximation of
 * residual risk. ETFs held in the book count as exposure to themselves. By
 * default each name is hedged at its own L* level (`hedge_level: "lstar"`).
 *
 * Math: lib/portfolio/signed-exposure.ts. Loading: lib/portfolio/signed-exposure-data.ts.
 * Unlike /portfolio/risk-index, nothing is normalised or weight-averaged.
 */

import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import { PortfolioExposureRequestSchema } from "@/lib/api/schemas";
import { asOfBeforeEarliest, computePortfolioExposure } from "@/lib/portfolio/signed-exposure-data";
import { getCorsHeaders } from "@/lib/cors";
import { transitionPositions, type PositionTransition } from "@/lib/identity/transition-positions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type TransitionDroppedPosition = { ticker: string; value_usd: number; reason: string; detail: string };

function datedBookCoverage(
  submitted: Array<{ ticker: string; value: number }>,
  transitions: PositionTransition[] | undefined,
): { inputGrossUsd: number; dropped: TransitionDroppedPosition[] } {
  const inputGrossUsd = submitted.reduce((sum, p) => sum + Math.abs(p.value), 0);
  const valueByTicker = new Map<string, number>();
  for (const p of submitted) {
    const ticker = p.ticker.trim().toUpperCase();
    valueByTicker.set(ticker, (valueByTicker.get(ticker) ?? 0) + p.value);
  }
  const dropped = (transitions ?? [])
    .filter((t) => t.status === "dropped")
    .map((t) => ({
      ticker: t.submitted_ticker,
      value_usd: valueByTicker.get(t.submitted_ticker) ?? 0,
      reason: t.outcome,
      detail: t.detail,
    }));
  return { inputGrossUsd, dropped };
}

/** Distinct tickers submitted: sets the price tier for the pre-flight balance check. */
async function getItemCount(req: NextRequest): Promise<number | undefined> {
  try {
    const body = await req.clone().json();
    if (!Array.isArray(body?.positions)) return undefined;
    return new Set(
      body.positions.map((p: { ticker?: unknown }) => String(p?.ticker ?? "").toUpperCase()),
    ).size;
  } catch {
    return undefined;
  }
}

export const POST = withBilling(
  async (request: NextRequest, context: BillingContext) => {
    const origin = request.headers.get("origin");

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request", message: "Body must be valid JSON" },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const validation = PortfolioExposureRequestSchema.safeParse(payload);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request", message: validation.error.issues[0].message },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const { positions: submitted, lookback_days, hedge_level, as_of, positions_as_of, top_contributors, include_positions } =
      validation.data;

    const earliestErr = asOfBeforeEarliest(as_of);
    if (earliestErr) {
      // Before any model data is read: a 4xx, so not billed.
      return NextResponse.json(earliestErr, { status: 422, headers: getCorsHeaders(origin) });
    }

    try {
      const fetchStart = performance.now();
      // ERM3-73: a dated book is read as of the date it was recorded and carried to the model date through
      // reviewed corporate-action events. Without either date the book is today's and passes through.
      let positions = submitted;
      let transitions: PositionTransition[] | undefined;
      if (as_of || positions_as_of) {
        const t = await transitionPositions(submitted, {
          heldOn: positions_as_of ?? as_of!,
          asOf: as_of ?? new Date().toISOString().slice(0, 10),
          mapCurrentTickerToHeldDate: Boolean(positions_as_of),
        });
        positions = t.positions;
        transitions = t.transitions;
        if (!positions.length) {
          const datedCoverage = datedBookCoverage(submitted, transitions);
          // Every position was removed by the dated-book transition: nothing to model, so not billed.
          return NextResponse.json(
            {
              error: "No modelled positions",
              message: "Every submitted position was removed by the dated-book transition; see transitions.",
              dropped: datedCoverage.dropped,
              coverage: { input_gross_usd: datedCoverage.inputGrossUsd, dropped: datedCoverage.dropped },
              transitions,
            },
            { status: 422, headers: getCorsHeaders(origin) },
          );
        }
      }
      const result = await computePortfolioExposure(positions, {
        lookbackDays: lookback_days,
        basis: hedge_level,
        asOf: as_of,
        topContributors: top_contributors,
        includePositions: include_positions,
      });

      if ("error" in result) {
        const datedCoverage = datedBookCoverage(submitted, transitions);
        // No stock with metrics and no ETF held with returns: a 4xx, so not billed.
        return NextResponse.json(
          {
            error: "No modelled positions",
            message:
              "None of the submitted positions could be modelled: no stock has risk metrics at the model date and no ETF held has return history. Each entry in dropped gives the ticker's reason and a one-line detail.",
            dropped: [...datedCoverage.dropped, ...(result.dropped ?? [])],
            coverage: {
              input_gross_usd: datedCoverage.inputGrossUsd,
              dropped: [...datedCoverage.dropped, ...(result.dropped ?? [])],
            },
            ...(transitions ? { transitions } : {}),
          },
          { status: 422, headers: getCorsHeaders(origin) },
        );
      }

      // Bill the tier for names actually modelled (stocks plus ETFs held), not
      // names submitted: dropped tickers never push a book into the higher tier.
      context.setBillableItemCount?.(result.book.modelled_stocks + result.book.direct_etfs);

      const metadata = await getRiskMetadata();
      const latency = Math.round(performance.now() - fetchStart);
      const datedCoverage = datedBookCoverage(submitted, transitions);
      const resultWithDatedCoverage = datedCoverage.dropped.length
        ? {
            ...result,
            coverage: {
              ...result.coverage,
              input_gross_usd: datedCoverage.inputGrossUsd,
              dropped: [...datedCoverage.dropped, ...result.coverage.dropped],
            },
          }
        : result;
      const response = NextResponse.json(
        {
          ...resultWithDatedCoverage,
          ...(transitions ? { transitions } : {}),
          _metadata: buildMetadataBody(metadata, { data_source: "zarr" }),
          _agent: {
            cost_usd: context.costUsd,
            request_id: context.requestId,
            latency_ms: latency,
          },
        },
        {
          headers: {
            ...getCorsHeaders(origin),
            "X-Data-Fetch-Latency-Ms": String(latency),
          },
        },
      );
      addMetadataHeaders(response, metadata);
      return response;
    } catch (err) {
      console.error("[portfolio/exposure] failed:", err);
      return NextResponse.json(
        { error: "Internal error", message: "Exposure computation failed" },
        { status: 500, headers: getCorsHeaders(origin) },
      );
    }
  },
  { capabilityId: "portfolio-exposure", getItemCount },
);

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(origin) });
}
