/**
 * GET /api/cron/exposure-history-cleanup
 *
 * Vercel Cron (daily): delete expired exposure-history feed files from the
 * private `exposure-history` Storage bucket (lib/supabase/exposure-history-cleanup.ts,
 * docs/EXPOSURE_HISTORY_FEED.md).
 * Auth: Authorization: Bearer CRON_SECRET (Vercel injects it for Cron invocations).
 *
 * Manual: curl -sS -H "Authorization: Bearer $CRON_SECRET" "https://riskmodels.app/api/cron/exposure-history-cleanup?dry_run=1"
 */

import { NextRequest, NextResponse } from "next/server";
import { readExposureMonthEndBuiltUtc } from "@/lib/dal/zarr-reader";
import {
  cleanupExposureHistory,
  maxAgeDaysFromEnv,
  supabaseBucketApi,
} from "@/lib/supabase/exposure-history-cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorize(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = ["1", "true"].includes(request.nextUrl.searchParams.get("dry_run") ?? "");
  try {
    // Without the current build, only the age rule applies.
    let currentBuiltUtc: string | null = null;
    try {
      currentBuiltUtc = await readExposureMonthEndBuiltUtc();
    } catch {
      currentBuiltUtc = null;
    }
    const result = await cleanupExposureHistory(supabaseBucketApi(), {
      maxAgeDays: maxAgeDaysFromEnv(),
      currentBuiltUtc,
      dryRun,
    });
    if (result.errors.length) console.error("[cron/exposure-history-cleanup]", result.errors.slice(0, 5));
    // Errors return 500. A run cut short by the time budget returns 200 with
    // complete: false; the next run starts at another random folder.
    const ok = result.errors.length === 0;
    if (!result.complete) console.warn("[cron/exposure-history-cleanup] incomplete", result.scanned, "/", result.folders);
    return NextResponse.json(
      { ok, current_built_utc: currentBuiltUtc, ...result },
      { status: ok ? 200 : 500 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron/exposure-history-cleanup]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
