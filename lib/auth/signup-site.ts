/**
 * Which site a user first signed in on. The Supabase project is shared with
 * riskmodels.net and RefiGeek, so the auth user alone does not say.
 *
 * Client sign-in calls pass `options.data.signup_site` (lands in
 * `user_metadata` when the call creates the user). OAuth sign-ins carry no
 * such data, so the server also writes `app_metadata.signup_site` with the
 * service role. An existing value is never replaced.
 */
export const SIGNUP_SITE = "riskmodels.app";

type AuthAdmin = {
  auth: {
    admin: {
      updateUserById: (
        id: string,
        attrs: { app_metadata: Record<string, unknown> },
      ) => Promise<{ error: { message: string } | null }>;
    };
  };
};

type UserLike = {
  id: string;
  app_metadata?: Record<string, unknown> | null;
};

/**
 * Write `app_metadata.signup_site` when it is absent. Returns whether a write
 * happened. Never throws: sign-in must not fail on this.
 */
export async function ensureSignupSite(admin: AuthAdmin, user: UserLike): Promise<boolean> {
  const existing = user.app_metadata?.signup_site;
  if (typeof existing === "string" && existing) return false;
  try {
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      app_metadata: { ...(user.app_metadata ?? {}), signup_site: SIGNUP_SITE },
    });
    if (error) {
      console.warn("[signup-site] update failed:", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[signup-site] update threw:", e instanceof Error ? e.message : e);
    return false;
  }
}
