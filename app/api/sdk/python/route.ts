/**
 * Python SDK hints for clients (notebooks, CLIs) — canonical upgrade copy.
 *
 * GET /api/sdk/python — public, no auth.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Keep in sync with sdk/pyproject.toml when bumping features. */
const DEFAULT_MIN_VERSION = process.env.RISKMODELS_PY_MIN_VERSION ?? "0.2.4";

export async function GET() {
  const upgrade_message =
    process.env.RISKMODELS_PY_UPGRADE_MESSAGE?.trim() ||
    [
      "Upgrade the Python SDK (riskmodels-py) so you have the latest helpers (e.g. format_metrics_snapshot).",
      `Run: pip install -U "riskmodels-py>=${DEFAULT_MIN_VERSION}"`,
      "Editable from a clone: pip install -e RiskModels_API/sdk",
      "From BWMACRO: pip install -r requirements-sdk-tests.txt",
    ].join(" ");

  const body = {
    package: "riskmodels-py",
    min_version: DEFAULT_MIN_VERSION,
    upgrade_message,
    docs_url: "https://riskmodels.app/docs",
  };

  return NextResponse.json(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
