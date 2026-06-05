/**
 * Feedback API
 *
 * Lets an agent (or human) flag a specific API result by its request_id with a
 * rating / category / correction note. Trust-loop signal: offline triage drives
 * data-quality and docs fixes. Authenticated and free (no metering); abuse is
 * bounded by key auth and a 4000-char comment cap.
 *
 * POST /api/feedback
 *   { request_id?, capability_id?, rating?: 'up'|'down', category?, comment? }
 *
 * Writes to public.feedback_events (service-role). See BWMACRO migration
 * 20260605120000_feedback_events.sql.
 */

import { NextRequest, NextResponse } from "next/server";
import { extractApiKey, validateApiKey } from "@/lib/agent/api-keys";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateRequestId } from "@/lib/agent/telemetry";
import { METHODOLOGY_URL } from "@/lib/constants";

export const dynamic = "force-dynamic";

const MAX_COMMENT = 4000;
const RATINGS = new Set(["up", "down"]);
const CATEGORIES = new Set([
  "data_quality",
  "incorrect_result",
  "latency",
  "docs",
  "feature_request",
  "other",
]);

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  const requestId = generateRequestId();
  const agent = () => ({
    request_id: requestId,
    latency_ms: Date.now() - startTime,
    provenance: METHODOLOGY_URL,
  });

  // 1. Authenticate (no metering — feedback is free).
  const key = extractApiKey(req);
  const validation = key ? await validateApiKey(key) : null;
  if (!validation?.valid || !validation.userId) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        message: "A valid API key is required to submit feedback.",
        _agent: { ...agent(), action: "authenticate", authenticate_url: "/api/auth/provision-free" },
      },
      { status: 401 },
    );
  }

  // 2. Parse + validate body.
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body", _agent: agent() },
      { status: 400 },
    );
  }

  const request_id =
    typeof body.request_id === "string" ? body.request_id.slice(0, 128) : null;
  const capability_id =
    typeof body.capability_id === "string" ? body.capability_id.slice(0, 128) : null;
  const rating = typeof body.rating === "string" ? body.rating : null;
  const category = typeof body.category === "string" ? body.category : null;
  const comment = typeof body.comment === "string" ? body.comment.trim() : null;

  if (rating !== null && !RATINGS.has(rating)) {
    return NextResponse.json(
      { error: "Invalid rating", message: "rating must be 'up' or 'down'.", _agent: agent() },
      { status: 400 },
    );
  }
  if (category !== null && !CATEGORIES.has(category)) {
    return NextResponse.json(
      {
        error: "Invalid category",
        message: `category must be one of: ${[...CATEGORIES].join(", ")}.`,
        _agent: agent(),
      },
      { status: 400 },
    );
  }
  if (comment !== null && comment.length > MAX_COMMENT) {
    return NextResponse.json(
      { error: "Comment too long", message: `comment must be <= ${MAX_COMMENT} chars.`, _agent: agent() },
      { status: 400 },
    );
  }
  // Require at least one substantive signal.
  if (!rating && !category && !comment) {
    return NextResponse.json(
      {
        error: "Empty feedback",
        message: "Provide at least one of: rating, category, comment.",
        _agent: agent(),
      },
      { status: 400 },
    );
  }

  // 3. Persist via service-role client.
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("feedback_events")
      .insert({
        user_id: validation.userId,
        request_id,
        capability_id,
        rating,
        category,
        comment: comment || null,
        metadata: {
          user_agent: req.headers.get("user-agent"),
          ip_address: req.headers.get("x-forwarded-for") || "unknown",
          referer: req.headers.get("referer"),
        },
      })
      .select("id")
      .single();

    if (error) {
      // Most likely cause before the migration is pushed: relation does not exist.
      console.error("[Feedback] insert failed:", error.message);
      return NextResponse.json(
        {
          error: "Feedback store unavailable",
          message: "Could not record feedback right now. Please retry shortly.",
          _agent: { ...agent(), action: "retry" },
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        feedback_id: data.id,
        message: "Thanks — feedback recorded.",
        _agent: agent(),
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[Feedback] unexpected error:", err);
    return NextResponse.json(
      {
        error: "Feedback store unavailable",
        message: "Could not record feedback right now. Please retry shortly.",
        _agent: { ...agent(), action: "retry" },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
