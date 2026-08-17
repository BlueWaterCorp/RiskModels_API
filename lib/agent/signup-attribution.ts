/**
 * First-touch signup attribution on agent_accounts.signup_attribution (jsonb).
 *
 * Sign-up conversions fire at first auth. Attribution used to wait until
 * POST /api/agent-keys, so Ads sign-ins that never minted a key were invisible.
 * This module writes on the first authenticated touch (and later stamps
 * checkout / card events without overwriting first-touch fields).
 */
import type { UTMData } from "@/lib/utm";
import { sanitizeGclid } from "@/lib/utm";

export type Channel = "ads" | "organic";

export type AttributionTouch = {
  gclid?: string | null;
  utm?: UTMData | null;
  landing_path?: string | null;
};

type Admin = {
  from: (table: string) => {
    select: (cols: string) => any;
    insert: (row: Record<string, unknown>) => any;
    update: (row: Record<string, unknown>) => any;
  };
};

const MAX_LANDING_PATH_LEN = 512;

export function classifyChannel(input: {
  gclid?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
}): Channel {
  if (input.gclid) return "ads";
  const medium = (input.utm_medium || "").toLowerCase();
  if (["cpc", "ppc", "paid", "paidsearch"].includes(medium)) return "ads";
  return "organic";
}

function sanitizeLandingPath(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const path = raw.trim();
  if (!path.startsWith("/") || path.length > MAX_LANDING_PATH_LEN) return null;
  return path;
}

function firstTouchPatch(
  current: Record<string, unknown>,
  touch: AttributionTouch,
): Record<string, unknown> {
  const gclid = sanitizeGclid(touch.gclid ?? null);
  const utm = touch.utm ?? null;
  const landing = sanitizeLandingPath(
    touch.landing_path ?? utm?.landing_path ?? null,
  );
  const next = { ...current };
  const now = new Date().toISOString();

  if (gclid && !next.gclid) {
    next.gclid = gclid;
    next.gclid_at = now;
  }
  if (utm) {
    if (!next.utm_source && utm.utm_source) next.utm_source = utm.utm_source;
    if (!next.utm_medium && utm.utm_medium) next.utm_medium = utm.utm_medium;
    if (!next.utm_campaign && utm.utm_campaign) next.utm_campaign = utm.utm_campaign;
    if (!next.utm_content && utm.utm_content) next.utm_content = utm.utm_content;
    if (!next.referrer && utm.referrer) next.referrer = utm.referrer;
    if (!next.timestamp && utm.timestamp) next.timestamp = utm.timestamp;
  }
  if (landing && !next.landing_path) next.landing_path = landing;
  if (!next.channel) {
    next.channel = classifyChannel({
      gclid: (next.gclid as string | undefined) ?? gclid,
      utm_source: (next.utm_source as string | null) ?? utm?.utm_source ?? null,
      utm_medium: (next.utm_medium as string | null) ?? utm?.utm_medium ?? null,
    });
    next.channel_at = now;
  }
  return next;
}

async function loadOldestAccount(
  admin: Admin,
  userId: string,
): Promise<{ id: string; signup_attribution: Record<string, unknown> } | null> {
  const { data, error } = await admin
    .from("agent_accounts")
    .select("id, signup_attribution")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[signup-attribution] select failed:", error.message);
    return null;
  }
  if (!data?.id) return null;
  const sa = (data.signup_attribution ?? {}) as Record<string, unknown>;
  return { id: data.id as string, signup_attribution: sa };
}

/**
 * Ensure an agent_accounts row exists so Ads sign-ins are visible before key mint.
 * Does not grant starter credits.
 */
async function ensureAccountRow(
  admin: Admin,
  userId: string,
  email: string | null,
  attribution: Record<string, unknown>,
): Promise<string | null> {
  const existing = await loadOldestAccount(admin, userId);
  if (existing) return existing.id;

  const contact = email || `user-${userId.slice(0, 8)}@example.com`;
  const { data, error } = await admin
    .from("agent_accounts")
    .insert({
      user_id: userId,
      agent_id: `touch_${Date.now()}`,
      agent_name: contact.split("@")[0] || "API User",
      contact_email: contact,
      balance_usd: 0,
      status: "active",
      signup_attribution: attribution,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // Unique race: another request inserted first.
    console.warn("[signup-attribution] insert failed:", error.message);
    const again = await loadOldestAccount(admin, userId);
    return again?.id ?? null;
  }
  return (data?.id as string) ?? null;
}

/** Merge first-touch gclid/UTM/channel. Optionally creates a $0 account row. */
export async function persistFirstTouchAttribution(
  admin: Admin,
  userId: string,
  email: string | null,
  touch: AttributionTouch,
  opts?: { createIfMissing?: boolean },
): Promise<void> {
  const existing = await loadOldestAccount(admin, userId);
  const current = existing?.signup_attribution ?? {};
  const next = firstTouchPatch(current, touch);
  if (existing && current.prior_account === true) {
    next.prior_account = true;
  } else if (
    existing &&
    !current.channel &&
    !current.gclid &&
    !current.first_api_use_at
  ) {
    // Billing row existed before this first-touch write (returning user).
    next.prior_account = true;
  }
  if (!existing) {
    if (!opts?.createIfMissing) return;
    await ensureAccountRow(admin, userId, email, next);
    return;
  }
  const { error } = await admin
    .from("agent_accounts")
    .update({
      signup_attribution: next,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id);
  if (error) {
    console.warn("[signup-attribution] update failed:", error.message);
  }
}

/** Set a later funnel timestamp if vacant (checkout started, card added). */
export async function stampAttributionEvent(
  admin: Admin,
  userId: string,
  fields: Record<string, string>,
): Promise<void> {
  const existing = await loadOldestAccount(admin, userId);
  if (!existing) return;
  const next = { ...existing.signup_attribution };
  let changed = false;
  for (const [key, value] of Object.entries(fields)) {
    if (!next[key]) {
      next[key] = value;
      changed = true;
    }
  }
  if (!changed) return;
  const { error } = await admin
    .from("agent_accounts")
    .update({
      signup_attribution: next,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id);
  if (error) {
    console.warn("[signup-attribution] stamp failed:", error.message);
  }
}

export { firstTouchPatch };
