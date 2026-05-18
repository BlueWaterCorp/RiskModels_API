import { NextResponse } from "next/server";
import { getAppUrl } from "@/lib/app-url";

export const dynamic = "force-dynamic";

/**
 * Deprecated — use GET /api/ticker-returns.
 */
export async function GET() {
  const base = getAppUrl().replace(/\/$/, "");
  const successor = `${base}/api/ticker-returns`;
  return NextResponse.json(
    {
      error: "gone",
      message:
        "This route is removed. Use GET /api/ticker-returns with your ticker.",
      replacement: successor,
    },
    {
      status: 410,
      headers: {
        "Content-Type": "application/json",
        Deprecation: "true",
        Sunset: "Wed, 01 Jan 2025 00:00:00 GMT",
        Link: `<${successor}>; rel="successor-version"`,
      },
    },
  );
}
