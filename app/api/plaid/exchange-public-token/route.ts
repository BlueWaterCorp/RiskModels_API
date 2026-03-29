import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { authenticateRequest } from "@/lib/supabase/auth-helper";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCorsHeaders } from "@/lib/cors";
import { getPlaidClient } from "@/lib/plaid/client";
import {
  encryptPlaidAccessToken,
  serializeEncryptedToken,
} from "@/lib/plaid/token-crypto";

export const dynamic = "force-dynamic";

export const POST = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const origin = request.headers.get("origin");
    const { user, error } = await authenticateRequest(request);
    if (!user || error) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: getCorsHeaders(origin) },
      );
    }

    let body: { public_token?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const public_token = body?.public_token;
    if (!public_token || typeof public_token !== "string") {
      return NextResponse.json(
        { error: "Missing public_token" },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    try {
      encryptPlaidAccessToken("ping");
    } catch {
      return NextResponse.json(
        {
          error: "Service unavailable",
          message: "Plaid token encryption is not configured (PLAID_TOKEN_ENCRYPTION_SECRET)",
        },
        { status: 503, headers: getCorsHeaders(origin) },
      );
    }

    try {
      const plaid = getPlaidClient();
      const res = await plaid.itemPublicTokenExchange({ public_token });
      const accessToken = res.data.access_token;
      const itemId = res.data.item_id;

      const enc = encryptPlaidAccessToken(accessToken);
      const admin = createAdminClient();
      const { error: upError } = await admin.from("plaid_items").upsert(
        {
          user_id: user.id,
          item_id: itemId,
          encrypted_access_token: serializeEncryptedToken(enc),
          institution_id: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,item_id" },
      );

      if (upError) {
        console.error("[plaid/exchange-public-token] upsert", upError);
        return NextResponse.json(
          { error: "Failed to store Plaid item" },
          { status: 500, headers: getCorsHeaders(origin) },
        );
      }

      return NextResponse.json(
        {
          item_id: itemId,
          request_id: res.data.request_id,
        },
        { headers: getCorsHeaders(origin) },
      );
    } catch (e) {
      console.error("[plaid/exchange-public-token]", e);
      const message = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        { error: "Plaid exchange failed", message },
        { status: 500, headers: getCorsHeaders(origin) },
      );
    }
  },
  { capabilityId: "plaid-exchange-public-token", skipBilling: true },
);

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(origin) });
}
