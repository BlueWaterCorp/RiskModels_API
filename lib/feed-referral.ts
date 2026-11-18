import type { SupabaseClient } from "@supabase/supabase-js";
import { FEED_PAGE_URL } from "@/lib/feed-descriptor";
import { REFERRAL_CODE_RE } from "@/lib/feed-waitlist";
import { safeErrorCode } from "@/lib/safe-log";

/** Public signup link that attributes a new contact to this row once they confirm. */
export function feedInviteUrl(code: string | null | undefined): string | null {
  const normalized = code?.trim().toLowerCase() ?? "";
  if (!REFERRAL_CODE_RE.test(normalized)) return null;
  return `${FEED_PAGE_URL}?ref=${encodeURIComponent(normalized)}`;
}

/** The public colleague link for this address, or null when the row or its code cannot be read. */
export async function lookupFeedInviteUrl(admin: SupabaseClient, email: string): Promise<string | null> {
  let data: unknown;
  try {
    const result = await admin.from("feed_waitlist").select("referral_code").eq("email", email).maybeSingle();
    if (result.error) {
      console.error("[feed-waitlist] invite_lookup_failed", safeErrorCode(result.error));
      return null;
    }
    data = result.data;
  } catch (err) {
    console.error("[feed-waitlist] invite_lookup_failed", safeErrorCode(err));
    return null;
  }
  const code =
    data && typeof data === "object" && "referral_code" in data
      ? (data as { referral_code?: unknown }).referral_code
      : null;
  return feedInviteUrl(typeof code === "string" ? code : null);
}
