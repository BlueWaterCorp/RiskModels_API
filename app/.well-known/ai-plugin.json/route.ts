import { NextResponse } from "next/server";
import { getAppUrl } from "@/lib/app-url";

export const dynamic = "force-dynamic";

export async function GET() {
  const base = getAppUrl().replace(/\/$/, "");
  const openapi = `${base}/openapi.json`;
  return NextResponse.json(
    {
      schema_version: "v1",
      name_for_human: "RiskModels",
      name_for_model: "riskmodels",
      description_for_human:
        "Factor risk decomposition and ETF hedge ratios for US equities (~3,000 names).",
      description_for_model:
        "REST API for L1/L2/L3 explained risk, hedge ratios, ticker returns, and portfolio snapshots. Use Bearer rm_agent_* or rm_user_* keys.",
      auth: {
        type: "service_http",
        authorization_type: "bearer",
      },
      api: {
        type: "openapi",
        url: openapi,
      },
      logo_url: `${base}/favicon.ico`,
      contact_email: "service@riskmodels.app",
    },
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
