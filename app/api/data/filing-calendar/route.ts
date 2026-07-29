import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/data/filing-calendar
 *
 * Canonical SEC filing-deadline calendar — rule-derived headline dates
 * (universal 13F + the December-fiscal-year cohort windows for 10-K /
 * 10-Q / N-PORT / N-CEN). Backed by the `filing_calendar` table, which
 * the ERM3 `publish_filing_calendar` asset maintains.
 *
 * Optional filters:
 *   ?category=equity|fund    — filing category
 *   ?form=13F-HR             — exact form type
 *   ?from=YYYY-MM-DD         — due_date >= from
 *   ?to=YYYY-MM-DD           — due_date <= to
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const category = sp.get("category");
  const form = sp.get("form");
  const from = sp.get("from");
  const to = sp.get("to");

  const supabase = createAdminClient();

  let query = supabase
    .from("filing_calendar")
    .select(
      "form_type,period_label,period_end,due_date,category,is_universal,filer_status,notes",
    )
    .order("due_date", { ascending: true });

  if (category) query = query.eq("category", category);
  if (form) query = query.eq("form_type", form);
  if (from) query = query.gte("due_date", from);
  if (to) query = query.lte("due_date", to);

  const { data, error } = await query;

  if (error) {
    console.error("[data/filing-calendar] Error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({ events: data ?? [] });
}
