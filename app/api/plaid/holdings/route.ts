import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getCorsHeaders } from "@/lib/cors";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlaidClient } from "@/lib/plaid/client";
import {
  decryptPlaidAccessToken,
  encryptPlaidAccessToken,
  parseEncryptedToken,
} from "@/lib/plaid/token-crypto";
import { canAccessPlaidHoldings, resolveApiKeyScopes } from "@/lib/plaid/scope";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";

export const dynamic = "force-dynamic";

export const GET = withBilling(
  async (request: NextRequest, context: BillingContext) => {
    const origin = request.headers.get("origin");

    const scopes = await resolveApiKeyScopes(request);
    if (!canAccessPlaidHoldings(scopes)) {
      return NextResponse.json(
        {
          error: "Forbidden",
          message: "API key requires plaid:holdings scope when scopes are set",
        },
        { status: 403, headers: getCorsHeaders(origin) },
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

    let plaid;
    try {
      plaid = getPlaidClient();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        { error: "Plaid not configured", message },
        { status: 503, headers: getCorsHeaders(origin) },
      );
    }

    const admin = createAdminClient();
    const { data: rows, error } = await admin
      .from("plaid_items")
      .select("item_id, encrypted_access_token")
      .eq("user_id", context.userId);

    if (error) {
      console.error("[plaid/holdings] select", error);
      return NextResponse.json(
        { error: "Failed to load Plaid items" },
        { status: 500, headers: getCorsHeaders(origin) },
      );
    }

    const metadata = await getRiskMetadata();

    if (!rows?.length) {
      const body = {
        holdings: [] as Record<string, unknown>[],
        accounts: [] as Record<string, unknown>[],
        securities: [] as Record<string, unknown>[],
        connections_count: 0,
        summary: {
          total_value: 0,
          account_count: 0,
          position_count: 0,
        },
        _metadata: buildMetadataBody(metadata),
        _agent: {
          cost_usd: context.costUsd,
          request_id: context.requestId,
        },
      };
      const response = NextResponse.json(body, {
        headers: getCorsHeaders(origin),
      });
      addMetadataHeaders(response, metadata);
      return response;
    }

    const holdingsOut: Record<string, unknown>[] = [];
    const accountsOut: Record<string, unknown>[] = [];
    const securitiesOut: Record<string, unknown>[] = [];
    const seenSec = new Set<string>();

    for (const row of rows) {
      let accessToken: string;
      try {
        accessToken = decryptPlaidAccessToken(
          parseEncryptedToken(row.encrypted_access_token as string),
        );
      } catch (e) {
        console.error("[plaid/holdings] decrypt item", row.item_id, e);
        continue;
      }

      try {
        const { data } = await plaid.investmentsHoldingsGet({
          access_token: accessToken,
        });

        const secMap = new Map(
          (data.securities ?? []).map((s) => [s.security_id, s]),
        );

        for (const h of data.holdings ?? []) {
          const s = h.security_id ? secMap.get(h.security_id) : undefined;
          holdingsOut.push({
            account_id: h.account_id,
            security_id: h.security_id,
            institution_value: h.institution_value,
            quantity: h.quantity,
            ticker: s?.ticker_symbol ?? null,
            name: s?.name ?? null,
            risk_metrics: null,
          });
        }

        for (const a of data.accounts ?? []) {
          accountsOut.push(a as unknown as Record<string, unknown>);
        }

        for (const s of data.securities ?? []) {
          const sid = s.security_id;
          if (!sid || seenSec.has(sid)) continue;
          seenSec.add(sid);
          securitiesOut.push(s as unknown as Record<string, unknown>);
        }
      } catch (e) {
        console.error("[plaid/holdings] investmentsHoldingsGet", row.item_id, e);
      }
    }

    const total_value = holdingsOut.reduce(
      (sum, h) => sum + (Number(h.institution_value) || 0),
      0,
    );

    const response = NextResponse.json(
      {
        holdings: holdingsOut,
        accounts: accountsOut,
        securities: securitiesOut,
        connections_count: rows.length,
        summary: {
          total_value,
          account_count: accountsOut.length,
          position_count: holdingsOut.length,
        },
        _metadata: buildMetadataBody(metadata),
        _agent: {
          cost_usd: context.costUsd,
          request_id: context.requestId,
        },
      },
      { headers: getCorsHeaders(origin) },
    );
    addMetadataHeaders(response, metadata);
    return response;
  },
  { capabilityId: "plaid-holdings" },
);

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(origin) });
}
