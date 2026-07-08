/**
 * Live widget: named-universe active membership -> OpenBB table.
 *
 * GET /openbb/widgets/universe-members?universe=uni_mc_3000&teo=
 * Maps /universe/{name}/members — active membership (universe mask AND daily
 * validity gate) at one trading day, latest by default.
 */
import { NextRequest, NextResponse } from "next/server";
import { noKeyRows } from "../../_lib/connect-probe";
import { openbbCors } from "../../_lib/cors";
import { bearerFromRequest, upstreamGet } from "../../_lib/upstream";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const cors = openbbCors(req);
  const universe = (req.nextUrl.searchParams.get("universe") || "uni_mc_3000").trim();
  const teo = (req.nextUrl.searchParams.get("teo") || "").trim();

  const key = bearerFromRequest(req);
  if (!key) return NextResponse.json(noKeyRows(), { headers: cors });

  const qs = teo ? `?teo=${encodeURIComponent(teo)}` : "";
  const { status, body } = await upstreamGet(
    `/universe/${encodeURIComponent(universe)}/members${qs}`,
    key,
  );
  if (status < 200 || status >= 300) {
    const message =
      (body as { error?: string; message?: string })?.error ||
      (body as { message?: string })?.message ||
      `Upstream returned ${status}`;
    return NextResponse.json({ error: message }, { status, headers: cors });
  }

  const members =
    (body as { members?: Array<{ symbol: string; ticker: string }> }).members ?? [];

  return NextResponse.json(members, { headers: cors });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: openbbCors(req) });
}
