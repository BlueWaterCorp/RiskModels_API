import { NextRequest, NextResponse } from "next/server";
import { CountryCode, Products } from "plaid";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { authenticateRequest } from "@/lib/supabase/auth-helper";
import { getCorsHeaders } from "@/lib/cors";
import { getPlaidClient } from "@/lib/plaid/client";

export const dynamic = "force-dynamic";

export const POST = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const origin = request.headers.get("origin");
    try {
      const { user, error } = await authenticateRequest(request);
      if (!user || error) {
        return NextResponse.json(
          { error: "Unauthorized" },
          { status: 401, headers: getCorsHeaders(origin) },
        );
      }

      const plaid = getPlaidClient();
      const res = await plaid.linkTokenCreate({
        user: { client_user_id: user.id },
        client_name: process.env.PLAID_CLIENT_DISPLAY_NAME || "RiskModels",
        products: [Products.Investments],
        country_codes: [CountryCode.Us],
        language: "en",
      });

      return NextResponse.json(
        {
          link_token: res.data.link_token,
          expiration: res.data.expiration ?? null,
        },
        { headers: getCorsHeaders(origin) },
      );
    } catch (e) {
      console.error("[plaid/link-token]", e);
      const message = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        { error: "Failed to create link token", message },
        { status: 500, headers: getCorsHeaders(origin) },
      );
    }
  },
  { capabilityId: "plaid-link-token", skipBilling: true },
);

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(origin) });
}
