/**
 * GET /security-master-feed/descriptor.json
 *
 * The always-current machine-readable description of the security master change
 * feed (lib/feed-descriptor.ts). The same JSON is embedded in every feed email.
 * Public, static, cacheable.
 */

import { NextResponse } from "next/server";
import { buildFeedDescriptor } from "@/lib/feed-descriptor";

export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(buildFeedDescriptor(), {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
