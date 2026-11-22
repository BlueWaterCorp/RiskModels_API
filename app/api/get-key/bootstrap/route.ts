/**
 * POST /api/get-key/bootstrap — the one server call /get-key makes for a
 * signed-in user. In order:
 *
 *   1. Marks the auth user with app_metadata.signup_site when it is unset.
 *   2. Creates the billing account with the $20 starter credit and the
 *      first-touch attribution in a single insert (or merges attribution into
 *      an existing row without replacing anything).
 *   3. If the user has never had an API key, issues one and returns the
 *      plaintext. Idempotent across reloads, tabs and instances: see
 *      lib/agent/first-key.ts. A repeat call returns `key: null`.
 *
 * The plaintext is returned once, in the response that created the key. It is
 * not stored and a later call cannot recover it.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyReferralBonus } from "@/lib/agent/billing";
import { findActiveAffiliateByCode, MAX_REFERRAL_CODE_LEN } from "@/lib/agent/affiliate";
import { ensureAccountWithAttribution, parseAttributionTouch } from "@/lib/agent/account-bootstrap";
import { issueFirstKeyIfNone } from "@/lib/agent/first-key";
import { notifyKeyIssued } from "@/lib/agent/key-issued-email";
import { ensureSignupSite } from "@/lib/auth/signup-site";

export const dynamic = "force-dynamic";

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
  const admin = createAdminClient();

  await ensureSignupSite(admin, user);

  let account: "created" | "existing";
  try {
    ({ account } = await ensureAccountWithAttribution(admin, user, parseAttributionTouch(body)));
  } catch (e) {
    console.error("[get-key/bootstrap] account setup failed:", e instanceof Error ? e.message : e);
    return NextResponse.json(
      {
        error: "Account setup failed",
        message: "Could not set up your billing account. Reload the page or contact support.",
      },
      { status: 500 },
    );
  }

  let referralCodeRaw =
    typeof body.referral_code === "string" && body.referral_code.trim()
      ? body.referral_code.trim()
      : null;
  if (referralCodeRaw && referralCodeRaw.length > MAX_REFERRAL_CODE_LEN) referralCodeRaw = null;

  let affiliate: Awaited<ReturnType<typeof findActiveAffiliateByCode>> = null;
  try {
    affiliate = await findActiveAffiliateByCode(admin, referralCodeRaw);
  } catch (e) {
    console.warn("[get-key/bootstrap] affiliate lookup failed:", e instanceof Error ? e.message : e);
  }

  const result = await issueFirstKeyIfNone(admin, user.id, {
    referralCode: affiliate ? affiliate.referral_code : referralCodeRaw,
    referredByAffiliateId: affiliate?.id ?? null,
  });

  if (!result.issued) {
    return NextResponse.json({ ok: true, account, key: null, key_status: result.reason });
  }

  // Same two-sided bonus the Generate button applies; deduped per user.
  if (affiliate) {
    const bonus = await applyReferralBonus(user.id, affiliate.referral_code).catch(
      (e: unknown) => ({ ok: false as const, message: e instanceof Error ? e.message : "error" }),
    );
    if (!bonus.ok) console.warn("[get-key/bootstrap] referral bonus failed (continuing):", bonus.message);
  }

  await notifyKeyIssued(
    admin,
    user.id,
    result.key,
    result.key.plainKey,
    { workflow: body.workflow, agentClient: body.agent_client },
    "get-key/bootstrap",
  );

  return NextResponse.json(
    { ok: true, account, key: result.key, key_status: "issued" },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
