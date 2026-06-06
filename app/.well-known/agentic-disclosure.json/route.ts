import { NextResponse } from "next/server";
import { getAppUrl } from "@/lib/app-url";

export const dynamic = "force-dynamic";

/** Agentic / marketplace disclosure — high-level, non-legal summary; see policies on site. */
export async function GET() {
  const base = getAppUrl().replace(/\/$/, "");
  return NextResponse.json(
    {
      service: {
        name: "RiskModels",
        description: "Quantitative equity risk analytics API",
        base_url: base,
      },
      data_handling: {
        encryption_at_rest: "Managed by Supabase (PostgreSQL) and Google Cloud Storage.",
        encryption_in_transit: "TLS 1.2+ for all API traffic.",
        retention: "Per customer agreement and product privacy policy.",
        user_content_in_model_training: false,
      },
      third_party_sharing: {
        sells_user_data: false,
        shares_with_advertisers: false,
      },
      ai_model_usage: {
        training_on_customer_api_payloads: false,
        notes: "Optional chat features may call third-party LLMs with user prompts only when invoked.",
      },
      compliance: {
        notes: "See site Terms and Privacy Policy for authoritative commitments.",
        frameworks_aspirational: ["GDPR-oriented practices", "SOC2 roadmap"],
      },
      reproducibility: {
        point_in_time_from: "2006-01-04",
        deterministic: true,
        notes:
          "Decompositions are point-in-time and replayable; outputs carry model_version, data_as_of, and factor_set_id for citation in regulated workflows (13F, fund attribution).",
      },
      audit: {
        request_correlation: "Every response carries _agent.request_id (also the X-Request-ID header).",
        billing_trail: "Each metered call writes a billing event keyed by request_id.",
        idempotency: "POST requests accept an Idempotency-Key header for safe, auditable retries.",
      },
      security: {
        authentication: "API keys (rm_agent_* / rm_user_*) and OAuth for the portal",
        links: {
          security_contact: "service@riskmodels.app",
        },
      },
      transparency: {
        openapi: `${base}/openapi.json`,
        documentation: `${base}/docs/api`,
      },
    },
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
