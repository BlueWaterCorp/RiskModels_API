import { NextRequest, NextResponse } from "next/server";
import { finosCors } from "../../_lib/cors";
import {
  renderManagerSkillReview,
  type FilerSnapshot,
} from "../../_lib/manager-skill";
import { BERKSHIRE_FILER_ID } from "../../_lib/manifests";
import {
  bearerFromFinosRequest,
  getRiskModelsJson,
} from "../../_lib/upstream";

export const dynamic = "force-dynamic";

const FILER_ID = /^[A-Za-z0-9-]{1,80}$/;

export async function GET(req: NextRequest) {
  const cors = finosCors(req);
  const token = bearerFromFinosRequest(req);
  if (!token) {
    return NextResponse.json(
      { detail: "Connect FINOS Workspace with a RiskModels API token." },
      { status: 401, headers: cors },
    );
  }

  const bwFilerId =
    req.nextUrl.searchParams.get("bw_filer_id")?.trim() || BERKSHIRE_FILER_ID;
  if (!FILER_ID.test(bwFilerId)) {
    return NextResponse.json(
      { detail: "bw_filer_id is invalid." },
      { status: 400, headers: cors },
    );
  }

  let upstream: Awaited<ReturnType<typeof getRiskModelsJson>>;
  try {
    upstream = await getRiskModelsJson(
      `/13f/filers/${encodeURIComponent(bwFilerId)}/snapshot`,
      token,
    );
  } catch {
    return NextResponse.json(
      { detail: "RiskModels is temporarily unavailable." },
      { status: 502, headers: cors },
    );
  }

  if (upstream.status < 200 || upstream.status >= 300) {
    const body = upstream.body as { error?: string; message?: string } | null;
    return NextResponse.json(
      { detail: body?.error || body?.message || `RiskModels returned ${upstream.status}.` },
      { status: upstream.status, headers: cors },
    );
  }

  const headers = new Headers(cors);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "private, no-store");
  headers.set(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'",
  );
  return new NextResponse(
    renderManagerSkillReview(
      upstream.body as FilerSnapshot,
      req.nextUrl.searchParams.get("theme"),
    ),
    { status: 200, headers },
  );
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: finosCors(req) });
}
