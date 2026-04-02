import { NextRequest } from "next/server";
import { extractApiKey, validateApiKey } from "@/lib/agent/api-keys";
import { authenticateRequest } from "@/lib/supabase/auth-helper";

/** Resolve user id the same way as billing middleware (API key first, then session). */
export async function getBillingUserId(
  request: NextRequest,
): Promise<{ userId: string } | null> {
  const extractedKey = extractApiKey(request);
  if (extractedKey) {
    const validation = await validateApiKey(extractedKey);
    if (validation.valid && validation.userId) {
      return { userId: validation.userId };
    }
  }
  const { user } = await authenticateRequest(request);
  if (user) {
    return { userId: user.id };
  }
  return null;
}
