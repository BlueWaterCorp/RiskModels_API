/**
 * POST /api/admin/cache/fundamentals
 *
 * Purge the fundamentals-zarr Redis cache namespace
 * (`riskmodels:fundamentals_zarr:*` — the per-ticker row packs and any
 * siblings). Call after an ERM3 ds_fundamentals rebuild + GCS republish so
 * popular tickers stop serving a stale pack for up to the weekly TTL
 * (H.97: the rf-strip repair was live in GCS while AAPL kept serving
 * null-rf rows from this cache). Safe to call any time — the next request
 * per ticker recomputes from GCS.
 *
 * Auth: Authorization: Bearer CRON_SECRET (same machine-to-machine secret
 * as /api/admin/cache/funds). Production value lives in Doppler `erm3/prd`
 * (synced to Vercel). A bare `$CRON_SECRET` in the shell is often unset or
 * from `dev` and will 401 — pull from prd:
 *
 *   doppler run -p erm3 -c prd -- bash -c \
 *     'curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *      "https://riskmodels.app/api/admin/cache/fundamentals"'
 */

import { NextRequest, NextResponse } from "next/server";
import { deleteCachePattern } from "@/lib/cache/redis";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FUNDAMENTALS_ZARR_CACHE_PATTERN = "riskmodels:fundamentals_zarr:*";

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
    const deleted = await deleteCachePattern(FUNDAMENTALS_ZARR_CACHE_PATTERN);
    console.log(
      `[admin/cache/fundamentals] purged ${deleted} keys (${FUNDAMENTALS_ZARR_CACHE_PATTERN})`,
    );
    return NextResponse.json({
      ok: true,
      pattern: FUNDAMENTALS_ZARR_CACHE_PATTERN,
      deleted,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin/cache/fundamentals]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
