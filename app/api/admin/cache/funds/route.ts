/**
 * POST /api/admin/cache/funds
 *
 * Purge the funds-zarr Redis cache namespace (`riskmodels:funds_zarr:*`).
 * Called by the Funds_DAG supabase sync after its upsert burst so a snapshot
 * cached mid-sync (torn read, pre-refresh data) is evicted immediately
 * instead of aging out over the readers' TTL. Safe to call any time — the
 * next request per key just recomputes from GCS/Supabase.
 *
 * Auth: Authorization: Bearer CRON_SECRET (same machine-to-machine secret
 * the Vercel cron routes use).
 *
 * Manual: curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" "https://riskmodels.app/api/admin/cache/funds"
 */

import { NextRequest, NextResponse } from "next/server";
import { deleteCachePattern } from "@/lib/cache/redis";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FUNDS_ZARR_CACHE_PATTERN = "riskmodels:funds_zarr:*";

function authorize(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function POST(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const deleted = await deleteCachePattern(FUNDS_ZARR_CACHE_PATTERN);
    console.log(
      `[admin/cache/funds] purged ${deleted} keys (${FUNDS_ZARR_CACHE_PATTERN})`,
    );
    return NextResponse.json({
      ok: true,
      pattern: FUNDS_ZARR_CACHE_PATTERN,
      deleted,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin/cache/funds]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
