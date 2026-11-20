import { NextRequest, NextResponse } from "next/server";
import { finosCors } from "./_lib/cors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return NextResponse.json(
    {
      name: "RiskModels FINOS Workspace connector",
      status: "qualification-spike",
      workspace_release: "v0.1.0-alpha.1",
      widgets: "/finos/widgets.json",
      apps: "/finos/apps.json",
    },
    { headers: finosCors(req) },
  );
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: finosCors(req) });
}
