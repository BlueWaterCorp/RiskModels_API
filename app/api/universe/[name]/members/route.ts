/**
 * GET /api/universe/{name}/members
 *
 * Active membership of a named universe at a teo (latest by default).
 * Active = universe_mask AND validity. Universe mask is monthly (stamped at
 * month-end); validity is daily. Symbols failing either gate are NOT in the
 * response. The response carries a `counts` block with the pre-validity vs
 * post-validity breakdown so callers can sanity-check coverage, plus a
 * `mask_as_of` field surfacing the month-end stamp the mask was applied at —
 * useful for disambiguating "membership changed because new month" from
 * "membership changed because daily validity failed."
 *
 * `{name}` must match the KNOWN_UNIVERSES registry (uni_mc_50/500/1000/3000,
 * uni_dv_50/500/1000/3000). Unknown labels return 400 — we don't leak the
 * zarr-path semantics to callers.
 *
 * @see lib/risk/universe-members-service.ts
 * @see lib/dal/zarr-reader.ts::readUniverseMembers
 */

import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getUniverseMembers } from "@/lib/risk/universe-members-service";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import {
  addMetadataHeaders,
  buildMetadataBody,
} from "@/lib/dal/response-headers";
import {
  UniverseMembersRequestSchema,
  KNOWN_UNIVERSE_LABEL_SET,
} from "@/lib/api/schemas";
import { getCorsHeaders } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withBilling(
  async (request: NextRequest, context: BillingContext) => {
    const origin = request.headers.get("origin");
    // Extract {name} from the URL path. /api/universe/uni_mc_3000/members
    // → segments[-1]="members", segments[-2] = the universe label.
    const segments = request.nextUrl.pathname.split("/").filter(Boolean);
    const rawName = segments[segments.length - 2] ?? "";
    const { searchParams } = new URL(request.url);

    // Validate label against the registry before hitting the validator (gives
    // a clearer 400 message for the common "wrong label" case).
    if (!rawName || !KNOWN_UNIVERSE_LABEL_SET.has(rawName)) {
      return NextResponse.json(
        {
          error: "Unknown universe",
          message: `Universe label "${rawName ?? ""}" is not in the registered set. Valid: ${[
            ...KNOWN_UNIVERSE_LABEL_SET,
          ]
            .sort()
            .join(", ")}.`,
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const validation = UniverseMembersRequestSchema.safeParse({
      name: rawName,
      teo: searchParams.get("teo") ?? undefined,
    });
    if (!validation.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: validation.error.issues[0]!.message,
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const { name, teo } = validation.data;

    try {
      const fetchStart = performance.now();
      const result = await getUniverseMembers(name, { teo });

      if (!result) {
        return NextResponse.json(
          {
            error: "Not found",
            message: "Universe membership unavailable for the requested label / teo.",
          },
          { status: 404, headers: getCorsHeaders(origin) },
        );
      }

      const metadata = await getRiskMetadata();
      const fetchLatency = Math.round(performance.now() - fetchStart);

      const response = NextResponse.json(
        {
          ...result,
          _metadata: buildMetadataBody(metadata, {
            data_source: "zarr",
            range: [result.teo, result.teo],
          }),
        },
        {
          headers: {
            ...getCorsHeaders(origin),
            "X-Data-Fetch-Latency-Ms": String(fetchLatency),
          },
        },
      );
      addMetadataHeaders(response, metadata);
      return response;
    } catch (e) {
      const errMessage = e instanceof Error ? e.message : String(e);
      console.error(`[UniverseMembers]`, errMessage);
      return NextResponse.json(
        {
          error: "Internal Error",
          message: errMessage,
          request_id: context.requestId,
        },
        { status: 500, headers: getCorsHeaders(origin) },
      );
    }
  },
  { capabilityId: "universe-members" },
);
