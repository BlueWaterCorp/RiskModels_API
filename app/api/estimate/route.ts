/**
 * Cost Estimation API
 *
 * POST /api/estimate - Returns predicted cost before a request is made.
 * Free to call, authenticated (API key or session). Used by AI agents for pre-flight checks.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateOrRespond } from "@/lib/supabase/auth-helper";
import { extractApiKey, validateApiKey } from "@/lib/agent/api-keys";
import { estimateCost } from "@/lib/agent/cost-estimator";

export async function POST(request: NextRequest) {
  // Authenticate: API key or session
  let authenticated = false;

  const extractedKey = extractApiKey(request);
  if (extractedKey) {
    const validation = await validateApiKey(extractedKey);
    if (validation.valid) authenticated = true;
  }

  if (!authenticated) {
    const auth = await authenticateOrRespond(request);
    if ("response" in auth) return auth.response;
  }

  let body: { endpoint?: string; params?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body", message: "Expected JSON with endpoint and params" },
      { status: 400 },
    );
  }

  const { endpoint, params } = body;
  if (!endpoint || typeof endpoint !== "string") {
    return NextResponse.json(
      { error: "Missing endpoint", message: "Request must include endpoint (e.g. ticker-returns, batch-analyze)" },
      { status: 400 },
    );
  }

  const result = await estimateCost({ endpoint, params });
  if (!result) {
    return NextResponse.json(
      { error: "Unknown endpoint", message: `No cost estimate for endpoint: ${endpoint}` },
      { status: 400 },
    );
  }

  return NextResponse.json(result);
}
