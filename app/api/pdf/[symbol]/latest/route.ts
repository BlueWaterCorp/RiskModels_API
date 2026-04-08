/**
 * GET /api/pdf/[symbol]/latest
 *
 * Redirects to the most recent Deep Dive PDF for a ticker.
 * Checks Supabase Storage first; falls back to the existing
 * /api/metrics/[ticker]/snapshot.pdf generation route.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "reports";
const PREFIX = "tickers";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  const upper = symbol.toUpperCase();

  // Try Supabase Storage for pre-generated PDFs
  try {
    const supabase = createAdminClient();
    const folder = `${PREFIX}/${upper}`;

    const { data: files } = await supabase.storage
      .from(BUCKET)
      .list(folder, { sortBy: { column: "created_at", order: "desc" }, limit: 1 });

    if (files && files.length > 0) {
      const { data: urlData } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(`${folder}/${files[0].name}`, 3600); // 1hr expiry

      if (urlData?.signedUrl) {
        return NextResponse.redirect(urlData.signedUrl, 302);
      }
    }
  } catch {
    // Storage not configured yet — fall through to generation route
  }

  // No pre-generated PDF found
  return NextResponse.json(
    { error: "No snapshot available", ticker: upper },
    { status: 404 },
  );
}
