/**
 * Create a signed-in user's billing account with the starter credit and the
 * first-touch attribution in one step.
 *
 * Before this, /get-key fired GET /api/account (create the row with $20) and
 * POST /api/agent-accounts/attribution (create a $0 row with attribution) at
 * the same moment. Whichever insert lost the race either failed on the unique
 * user_id or wrote attribution onto a row it then re-read stale. Here the new
 * row is inserted once, already carrying both; an existing row gets the
 * starter top-up check and a first-touch merge that never replaces a value.
 */
import { ensureStarterCredits } from "@/lib/agent/billing";
import {
  firstTouchPatch,
  persistFirstTouchAttribution,
  type AttributionTouch,
} from "@/lib/agent/signup-attribution";
import { parseValidatedSignupUtm, sanitizeGclid } from "@/lib/utm";

type Admin = { from: (table: string) => any };

/** Validate a client- or URL-supplied touch. Unknown or malformed fields drop out. */
export function parseAttributionTouch(raw: Record<string, unknown>): AttributionTouch {
  return {
    gclid: sanitizeGclid(raw.gclid),
    utm: typeof raw.utm !== "undefined" && raw.utm !== null ? parseValidatedSignupUtm(raw.utm) : null,
    landing_path: typeof raw.landing_path === "string" ? raw.landing_path : null,
    referrer: typeof raw.referrer === "string" ? raw.referrer : null,
  };
}

export function touchIsEmpty(touch: AttributionTouch): boolean {
  return !touch.gclid && !touch.utm && !touch.landing_path && !touch.referrer;
}

export async function ensureAccountWithAttribution(
  admin: Admin,
  user: { id: string; email?: string | null },
  touch: AttributionTouch,
): Promise<{ account: "created" | "existing" }> {
  const initial = touchIsEmpty(touch) ? {} : firstTouchPatch({}, touch);

  let outcome: Awaited<ReturnType<typeof ensureStarterCredits>> | "raced";
  try {
    outcome = await ensureStarterCredits(user.id, { signupAttribution: initial });
  } catch (e) {
    // A concurrent request may have inserted the row first (unique user_id).
    const { data } = await admin
      .from("agent_accounts")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!data?.id) throw e;
    outcome = "raced";
  }

  if (outcome === "created") return { account: "created" };

  if (!touchIsEmpty(touch)) {
    await persistFirstTouchAttribution(admin as never, user.id, user.email ?? null, touch, {
      createIfMissing: false,
    });
  }
  return { account: "existing" };
}
