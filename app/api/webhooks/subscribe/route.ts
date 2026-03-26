import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/supabase/auth-helper";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCorsHeaders } from "@/lib/cors";
import { WebhookSubscribePostSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(request.headers.get("origin")),
  });
}

/**
 * GET — list webhook subscriptions for the authenticated user (secrets omitted).
 */
export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  const { user, error: authError } = await authenticateRequest(request);

  if (authError || !user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: getCorsHeaders(origin) },
    );
  }

  const admin = createAdminClient();
  const { data: subs, error } = await admin
    .from("webhook_subscriptions")
    .select("id, url, events, active, created_at, updated_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[webhooks/subscribe] GET", error);
    return NextResponse.json(
      { error: "Failed to list subscriptions" },
      { status: 500, headers: getCorsHeaders(origin) },
    );
  }

  return NextResponse.json(
    { subscriptions: subs ?? [] },
    { headers: getCorsHeaders(origin) },
  );
}

/**
 * POST — create a subscription. Returns `secret` once; store it for signature verification.
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const { user, error: authError } = await authenticateRequest(request);

  if (authError || !user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: getCorsHeaders(origin) },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: getCorsHeaders(origin) },
    );
  }

  const parsed = WebhookSubscribePostSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request",
        message: parsed.error.issues[0]?.message ?? "Validation failed",
      },
      { status: 400, headers: getCorsHeaders(origin) },
    );
  }

  const { url, events, active, secret: secretOpt } = parsed.data;
  const secret = secretOpt ?? randomBytes(32).toString("base64url");

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("webhook_subscriptions")
    .insert({
      user_id: user.id,
      url,
      secret,
      events,
      active: active ?? true,
    })
    .select("id, url, events, active, created_at")
    .single();

  if (error) {
    console.error("[webhooks/subscribe] POST insert", error);
    return NextResponse.json(
      { error: "Failed to create subscription" },
      { status: 500, headers: getCorsHeaders(origin) },
    );
  }

  return NextResponse.json(
    {
      subscription: {
        ...row,
        secret,
      },
    },
    { status: 201, headers: getCorsHeaders(origin) },
  );
}

/**
 * DELETE — remove a subscription by id (query: ?id=uuid).
 */
export async function DELETE(request: NextRequest) {
  const origin = request.headers.get("origin");
  const { user, error: authError } = await authenticateRequest(request);

  if (authError || !user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: getCorsHeaders(origin) },
    );
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { error: "Missing id query parameter" },
      { status: 400, headers: getCorsHeaders(origin) },
    );
  }

  const admin = createAdminClient();
  const { data: deleted, error } = await admin
    .from("webhook_subscriptions")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id");

  if (error) {
    console.error("[webhooks/subscribe] DELETE", error);
    return NextResponse.json(
      { error: "Failed to delete subscription" },
      { status: 500, headers: getCorsHeaders(origin) },
    );
  }

  if (!deleted?.length) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: getCorsHeaders(origin) },
    );
  }

  return NextResponse.json(
    { ok: true },
    { headers: getCorsHeaders(origin) },
  );
}
