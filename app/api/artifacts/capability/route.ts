import { NextRequest, NextResponse } from "next/server";

import {
  ARTIFACT_SUBJECT_KINDS,
  buildArtifactCapability,
  type ArtifactSubjectKind,
} from "@/lib/artifacts/render-client";
import { getCorsHeaders } from "@/lib/cors";

export const dynamic = "force-dynamic";

/**
 * `GET /api/artifacts/capability` — what (slug, subject_kind) pairs render.
 *
 * The reconciled capability table existed before this route and was reachable
 * from nowhere: `WIRED_ARTIFACT_RENDER_MATRIX` appeared only inside
 * `if (!result.ok)` failure payloads on the MCP and chat tools, so the only way
 * to learn what renders was to ask for something that did not. A client
 * assembling a surface out of N artifacts has to know the answer *before* it
 * mounts anything (G.53).
 *
 * The response is derived from `ARTIFACT_RENDER_CAPABILITY` on every request —
 * there is no second list to keep in sync, and an unverified pair is
 * unadvertisable by construction because `buildArtifactCapability` reads
 * `status === "verified"` rather than a hand-written array.
 *
 * Query params (all optional, all narrowing):
 *   `subject_kind`  one of ARTIFACT_SUBJECT_KINDS — the canvas's real question,
 *                   "what renders for this subject?"
 *   `slug`          narrow to one artifact.
 *
 * Unmetered and unauthenticated on purpose. This is discovery, not data: it
 * names renderers and subject kinds and returns no subject content, no
 * holdings, and no numbers. Metering it would put a billing decision in front
 * of the question "may I ask you anything at all", and every caller — the
 * canvas, an MCP agent, the docs — needs it before it can form a paid request.
 *
 * `unavailable` is served alongside `pairs` deliberately. A caller that sees
 * only the verified list cannot distinguish "we measured this and it does not
 * work" from "nobody has looked", and re-adding a hopeful pair is exactly the
 * regression the audit exists to prevent.
 */
export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  const sp = request.nextUrl.searchParams;

  const rawKind = sp.get("subject_kind");
  if (rawKind && !(ARTIFACT_SUBJECT_KINDS as readonly string[]).includes(rawKind)) {
    return NextResponse.json(
      {
        error: "Invalid request",
        message: `Unknown subject_kind '${rawKind}'`,
        accepted: ARTIFACT_SUBJECT_KINDS,
      },
      { status: 400, headers: getCorsHeaders(origin) },
    );
  }

  const slug = sp.get("slug")?.trim() || undefined;
  const document = buildArtifactCapability({
    subjectKind: (rawKind as ArtifactSubjectKind | null) ?? undefined,
    slug,
  });

  // A narrowing query that matches nothing is a 200 with an empty `pairs`
  // list, not a 404: "nothing renders for this subject kind" is a true and
  // useful answer, and the caller still needs `unavailable` to know why.
  return NextResponse.json(document, {
    headers: {
      ...getCorsHeaders(origin),
      // The table is a source constant, so it changes only on deploy. Short
      // enough that a capability promotion reaches clients the same hour.
      "Cache-Control": "public, max-age=300, s-maxage=900",
    },
  });
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(request.headers.get("origin")),
  });
}
