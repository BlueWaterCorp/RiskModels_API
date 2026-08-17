import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseValidatedSignupUtm, sanitizeGclid } from "@/lib/utm";
import { persistFirstTouchAttribution } from "@/lib/agent/signup-attribution";

export const dynamic = "force-dynamic";

/**
 * POST /api/agent-accounts/attribution
 * First-touch gclid/UTM on the signed-in user. 401 if no session (anonymous
 * landings stay in localStorage until auth).
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const gclid = sanitizeGclid(body.gclid);
  const utm =
    typeof body.utm !== "undefined" ? parseValidatedSignupUtm(body.utm) : null;
  const landing_path =
    typeof body.landing_path === "string" ? body.landing_path : null;

  if (!gclid && !utm && !landing_path) {
    return NextResponse.json({ ok: true, persisted: false });
  }

  const createIfMissing =
    Boolean(gclid || utm) || body.create_if_missing === true;

  const admin = createAdminClient();
  await persistFirstTouchAttribution(
    admin,
    user.id,
    user.email ?? null,
    { gclid, utm, landing_path },
    { createIfMissing },
  );
  return NextResponse.json({ ok: true, persisted: true });
}
