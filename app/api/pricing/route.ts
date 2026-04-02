import { NextResponse } from "next/server";
import { CAPABILITIES } from "@/lib/agent/capabilities";

export async function GET() {
  const endpoints = CAPABILITIES.map((cap) => ({
    id: cap.id,
    name: cap.name,
    path: cap.endpoint,
    method: cap.method,
    tier: cap.pricing.tier,
    pricing_model: cap.pricing.model,
    cost_usd: cap.pricing.cost_usd ?? null,
    input_cost_per_1k: cap.pricing.input_cost_per_1k ?? null,
    output_cost_per_1k: cap.pricing.output_cost_per_1k ?? null,
    min_charge: cap.pricing.min_charge ?? null,
    billing_code: cap.pricing.billing_code,
  }));

  return NextResponse.json(
    {
      version: "2026-04-01",
      currency: "USD",
      tiers: ["baseline", "premium"],
      endpoints,
      estimate_endpoint: "/api/estimate",
      docs: "https://riskmodels.app/pricing",
    },
    {
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
      },
    },
  );
}
