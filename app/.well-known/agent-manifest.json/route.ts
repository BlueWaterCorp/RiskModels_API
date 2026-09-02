import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getAppUrl } from "@/lib/app-url";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { FIRST_LIVE_PROMPT_MCP, FIRST_LIVE_PROMPT_REST } from "@/lib/mcp/activation";

export const dynamic = "force-dynamic";

const DATA_DIR = join(process.cwd(), "mcp", "data");

/** Earliest point-in-time coverage of the ERM3 history (see OPENAPI_SPEC.yaml info block). */
const POINT_IN_TIME_FROM = "2006-01-04";

/**
 * GET /.well-known/agent-manifest.json — agent discovery (MCP resource + installers).
 *
 * Single fetch an agent can read to decide whether and how to route to us:
 * what we do, where the schemas/pricing/disclosure live, and the
 * reproducibility guarantees that matter for quant/finance use.
 */
export async function GET() {
  const base = getAppUrl().replace(/\/$/, "");

  let capabilities: unknown[] | undefined;
  const capPath = join(DATA_DIR, "capabilities.json");
  if (existsSync(capPath)) {
    try {
      capabilities = JSON.parse(readFileSync(capPath, "utf-8")) as unknown[];
    } catch {
      capabilities = undefined;
    }
  }

  // Live provenance — model version, data recency, universe size, methodology URL.
  // Never let a metadata hiccup break the discovery artifact.
  let modelVersion: string | undefined;
  let dataAsOf: string | undefined;
  let universeSize: number | undefined;
  let methodologyUrl = `${base}/docs/methodology`;
  try {
    const meta = await getRiskMetadata();
    modelVersion = meta.model_version;
    dataAsOf = meta.data_as_of;
    universeSize = meta.universe_size;
    if (meta.wiki_uri) methodologyUrl = meta.wiki_uri;
  } catch {
    /* fall back to static links below */
  }

  const payload = {
    service: {
      name: "RiskModels",
      version: "3.0.0-agent",
      description:
        "Factor risk decomposition (L1/L2/L3 explained risk), ETF hedge ratios, and portfolio risk snapshots for ~3,000 US equities.",
      base_url: base,
      openapi_url: `${base}/openapi.json`,
      mcp_sse_url: `${base}/api/mcp/sse`,
    },
    // One-fetch cross-links to every other discovery / trust artifact.
    discovery: {
      openapi_url: `${base}/openapi.json`,
      mcp_manifest_url: `${base}/.well-known/mcp.json`,
      ai_plugin_url: `${base}/.well-known/ai-plugin.json`,
      disclosure_url: `${base}/.well-known/agentic-disclosure.json`,
      llms_txt_url: `${base}/llms.txt`,
      for_agents_url: `${base}/for-agents`,
      docs_url: `${base}/docs/agent-integration`,
      claude_plugin_marketplace_url: "https://github.com/BlueWaterCorp/riskmodels-plugin",
      privacy_url: `${base}/privacy`,
    },
    claude_plugin: {
      marketplace: "BlueWaterCorp/riskmodels-plugin",
      install: [
        "claude plugin marketplace add BlueWaterCorp/riskmodels-plugin",
        "claude plugin install riskmodels@riskmodels",
      ],
      mcp_url: `${base}/api/mcp/sse`,
      note: "Plugin adds skills/commands/analyst agent; keep one MCP connection (OAuth connector or plugin Bearer — not both).",
    },
    // Why a quant/finance agent can trust and cite a call.
    reproducibility: {
      deterministic: true,
      point_in_time_from: POINT_IN_TIME_FROM,
      model_version: modelVersion ?? null,
      data_as_of: dataAsOf ?? null,
      universe_size: universeSize ?? null,
      methodology_url: methodologyUrl,
      // Structured, citeable validation claims (model identity, OOS validation, ±0.1% replication).
      validation_manifest_url: "https://riskmodels.org/.well-known/methodology.json",
      replay: "Send an Idempotency-Key header on POST requests for safe, no-double-charge retries.",
      provenance_fields:
        "Every response carries _metadata.model_version / data_as_of / factor_set_id and _agent.request_id for audit.",
    },
    // Metered, pay-per-call. Authoritative per-endpoint rates live in the OpenAPI x-pricing blocks.
    pricing: {
      model: "per_request",
      currency: "USD",
      metered_header: "X-API-Cost-USD",
      cost_in_body: "_agent.cost_usd",
      free_credits_usd: 20,
      pricing_url: `${base}/pricing`,
      per_endpoint_rates: `${base}/openapi.json (x-pricing extension per path)`,
    },
    // Real-time health is published; aggregate latency/uptime SLAs are intentionally not
    // asserted here until measured (see GET /api/health).
    reliability: {
      health_url: `${base}/api/health`,
      status_values: ["up", "degraded", "down"],
      // Measured latency percentiles + success rate from real traffic (no asserted SLA).
      metrics_url: `${base}/api/status`,
    },
    // How an agent self-provisions and authenticates.
    onboarding: {
      auth: "Bearer token (rm_agent_* / rm_user_*)",
      provision_free_url: `${base}/api/auth/provision-free`,
      create_key_url: `${base}/api/agent-keys`,
      first_call_mcp: FIRST_LIVE_PROMPT_MCP,
      first_call_rest: FIRST_LIVE_PROMPT_REST,
    },
    // Trust loop: flag a result by its _agent.request_id to improve future output.
    feedback: {
      submit_url: `${base}/api/feedback`,
      method: "POST",
      fields: "request_id?, capability_id?, rating (up|down)?, category?, comment?",
    },
    capabilities: capabilities ?? [],
  };

  return NextResponse.json(payload, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
  });
}
