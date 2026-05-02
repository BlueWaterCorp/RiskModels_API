import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Branding metadata for chart watermarks.
 *
 * The Python SDK calls this once on `RiskModelsClient(...)` init and caches
 * the result for the session. Subsequent chart renders read from the cache.
 *
 * Response shape:
 *   show=true → render watermark; SDK uses display_handle and url.
 *   show=false → no watermark. Either no referral attribution exists,
 *                 or the affiliate is non-active, or the user passed
 *                 ?_branding=false.
 *
 * Opt-out per the API ToS clause: pass `?_branding=false` here, or call
 * `client.set_branding(False)` in the SDK (which sets the same flag on
 * every subsequent request).
 */
type BrandingResponse =
  | {
      show: true;
      display_handle: string;
      referral_code: string;
      url: string;
      hover_text: string;
      opt_out_method: string;
    }
  | {
      show: false;
      opt_out_method: string;
    };

const OPT_OUT_TEXT =
  "Pass _branding=false in any request, or call client.set_branding(False) in the SDK.";

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://riskmodels.app";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  /** Per-request opt-out: ?_branding=false suppresses the watermark for any
   *  follow-up request that uses the cached result of this one. The SDK
   *  honors this and avoids rendering even if cached show=true. */
  const optOut = request.nextUrl.searchParams.get("_branding") === "false";
  if (optOut) {
    return NextResponse.json<BrandingResponse>({
      show: false,
      opt_out_method: OPT_OUT_TEXT,
    });
  }

  const supabase = createAdminClient();

  const { data: keyRow } = await supabase
    .from("agent_api_keys")
    .select("referral_code, referred_by_affiliate_id")
    .eq("id", auth.keyId)
    .maybeSingle();

  /** Key has no referral attribution → no watermark. (riskmodels.app brand
   *  itself is added later if we want a baseline mark; for now, attributed
   *  keys only.) */
  if (!keyRow?.referred_by_affiliate_id || !keyRow.referral_code) {
    return NextResponse.json<BrandingResponse>({
      show: false,
      opt_out_method: OPT_OUT_TEXT,
    });
  }

  const { data: affRow } = await supabase
    .from("affiliates")
    .select("display_handle, referral_code, status, consent_v1_at")
    .eq("id", keyRow.referred_by_affiliate_id)
    .maybeSingle();

  /** Affiliate paused / revoked → no watermark. New referrals from this
   *  affiliate stop attributing immediately when their status changes. */
  if (!affRow || affRow.status !== "active" || !affRow.display_handle) {
    return NextResponse.json<BrandingResponse>({
      show: false,
      opt_out_method: OPT_OUT_TEXT,
    });
  }

  /** v1.1 enforcement: even if the affiliate has an active row + display
   *  handle, no watermark renders until they actively consent (banner on
   *  /affiliate or email-reply consent recorded by admin). The banner is
   *  the UX layer; this is the actual gate. */
  if (!affRow.consent_v1_at) {
    return NextResponse.json<BrandingResponse>({
      show: false,
      opt_out_method: OPT_OUT_TEXT,
    });
  }

  const code = affRow.referral_code;
  return NextResponse.json<BrandingResponse>({
    show: true,
    display_handle: affRow.display_handle,
    referral_code: code,
    url: `${APP_BASE_URL}/?ref=${encodeURIComponent(code)}`,
    /** Critical wording — distinguishes the act of generating a chart with
     *  the RiskModels API from the act of being referred by an affiliate.
     *  Required by the affiliate ToS (Section 2 "No endorsement") to
     *  mitigate implicit-endorsement risk. Revised v1.1 per legal review
     *  for clearer attribution-vs-endorsement separation. Do not change
     *  without legal review. */
    hover_text: `Chart generated with RiskModels API · Key referred via @${affRow.display_handle}. Click to learn more.`,
    opt_out_method: OPT_OUT_TEXT,
  });
}
