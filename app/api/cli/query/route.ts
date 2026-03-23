import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { createAdminClient } from "@/lib/supabase/admin";

function validateQuery(sql: string): { valid: boolean; sanitized?: string; error?: string } {
  const trimmed = sql.trim();

  if (!/^select\b/i.test(trimmed)) {
    return { valid: false, error: "Only SELECT queries allowed" };
  }

  // Strip string literals before checking for semicolons
  if (trimmed.replace(/'[^']*'/g, "").includes(";")) {
    return { valid: false, error: "Multiple statements not allowed" };
  }

  if (/\b(drop|delete|insert|update|alter|create|truncate|grant|revoke)\b/i.test(trimmed)) {
    return { valid: false, error: "Only SELECT queries are permitted" };
  }

  return { valid: true, sanitized: trimmed };
}

export const POST = withBilling(
  async (req: NextRequest, context: BillingContext) => {
    const body = await req.json();
    const { sql, limit = 100 } = body;

    if (!sql || typeof sql !== "string") {
      return NextResponse.json(
        { error: "Missing required field: sql" },
        { status: 400 },
      );
    }

    const validation = validateQuery(sql);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 },
      );
    }

    let query = validation.sanitized!;
    if (!/\blimit\b/i.test(query) && !/\bfetch\b/i.test(query)) {
      query += ` LIMIT ${Math.min(Math.max(parseInt(String(limit), 10) || 100, 1), 10000)}`;
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("exec_sql", { query });

    if (error) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400 },
      );
    }

    return NextResponse.json({
      results: data || [],
      count: data?.length || 0,
      sql: query,
    });
  },
  { capabilityId: "cli-query" },
);
