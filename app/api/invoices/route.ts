/**
 * GET /api/invoices — invoice-style view of billing_events + period summary.
 * Used by the quickstart notebook; linked from GET /api/balance _links.invoices.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/supabase/auth-helper";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateRequestId } from "@/lib/agent/telemetry";
import { createAgentErrorResponse } from "@/lib/agent/response-utils";
import { getCorsHeaders } from "@/lib/cors";

export const dynamic = "force-dynamic";

function periodStart(period: string): Date {
  const now = new Date();
  if (period === "year") {
    return new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
  }
  if (period === "all") {
    return new Date(0);
  }
  // month (default)
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

export async function GET(request: NextRequest) {
  const requestId = generateRequestId();
  const origin = request.headers.get("origin");

  try {
    const { user, error: authError, serverError } = await authenticateRequest(request);
    if (serverError) {
      return createAgentErrorResponse(
        "Server configuration error",
        "SERVER_SCHEMA_ERROR",
        500,
        "invoices",
        requestId,
        { detail: authError, action: "contact_support" },
      );
    }
    if (authError || !user) {
      const hadBearer = !!request.headers.get("authorization")?.startsWith("Bearer ");
      return createAgentErrorResponse(
        "Unauthorized",
        "AUTHENTICATION_FAILED",
        401,
        "invoices",
        requestId,
        hadBearer
          ? { auth_error: authError, action: "check_key", help_url: "https://riskmodels.app/get-key" }
          : { auth_error: authError, action: "authenticate", authenticate_url: "/api/auth/provision" },
      );
    }

    const { searchParams } = new URL(request.url);
    const rawLimit = parseInt(searchParams.get("limit") ?? "20", 10);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(100, Math.max(1, rawLimit))
      : 20;
    const period = (searchParams.get("period") ?? "month").toLowerCase();
    const periodKey =
      period === "year" || period === "all" || period === "month"
        ? period
        : "month";

    const start = periodStart(periodKey);
    const admin = createAdminClient();

    const { data: rows, error } = await admin
      .from("billing_events")
      .select(
        "id, type, cost_usd, capability_id, description, created_at, metadata",
      )
      .eq("user_id", user.id)
      .gte("created_at", start.toISOString())
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      console.error("[invoices]", error.message);
      return NextResponse.json(
        { error: "Failed to load billing events", message: error.message },
        { status: 500, headers: getCorsHeaders(origin) },
      );
    }

    const all = rows ?? [];
    const debits = all.filter((r) => r.type === "debit");
    const totalSpent = debits.reduce((sum, r) => {
      const c =
        typeof r.cost_usd === "number"
          ? r.cost_usd
          : parseFloat(String(r.cost_usd ?? 0));
      return sum + Math.abs(c);
    }, 0);

    const invoices = all.slice(0, limit).map((r) => {
      const amt =
        typeof r.cost_usd === "number"
          ? r.cost_usd
          : parseFloat(String(r.cost_usd ?? 0));
      return {
        id: r.id as string,
        status:
          r.type === "debit"
            ? "paid"
            : r.type === "credit"
              ? "credit"
              : "refund",
        amount_usd: Number(Math.abs(amt).toFixed(6)),
        created_at: r.created_at as string,
        capability_id: (r.capability_id as string) ?? null,
        description: (r.description as string) ?? null,
        type: r.type,
      };
    });

    const summary = {
      period: periodKey,
      total_invoices: all.length,
      total_spent_usd: Number(totalSpent.toFixed(4)),
      total_requests: debits.length,
      current_period_cost_usd: Number(totalSpent.toFixed(4)),
    };

    return NextResponse.json(
      {
        summary,
        invoices,
        _request_id: requestId,
      },
      { headers: getCorsHeaders(origin) },
    );
  } catch (e) {
    console.error("[invoices]", e);
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500, headers: getCorsHeaders(request.headers.get("origin")) },
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}
