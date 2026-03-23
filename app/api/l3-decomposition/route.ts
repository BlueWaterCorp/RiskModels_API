import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getL3DecompositionService } from "@/lib/risk/l3-decomposition-service";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";

export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get("ticker");
    const marketFactorEtf = searchParams.get("market_factor_etf") || "SPY";
    const dataSource = "factset";

    if (!ticker) {
      return NextResponse.json({ error: "Missing ticker" }, { status: 400 });
    }

    try {
      const service = getL3DecompositionService();
      const result = await service.getDecomposition(ticker, marketFactorEtf, dataSource);

      if (!result) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      const metadata = await getRiskMetadata();
      const response = NextResponse.json({
        ...result,
        _metadata: buildMetadataBody(metadata),
      });
      addMetadataHeaders(response, metadata);
      return response;
    } catch (e) {
      console.error("[L3 Decomposition] Error:", e);
      return NextResponse.json({ error: "Internal Error" }, { status: 500 });
    }
  },
  { capabilityId: "l3-decomposition" },
);
