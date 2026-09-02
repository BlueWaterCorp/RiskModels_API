import { NextRequest, NextResponse } from "next/server";

import { getBillingUserId } from "@/lib/agent/billing-user";
import {
  ARTIFACT_DISCOVERY_ROUTES,
  latestResolutionFor,
  listArtifactVintages,
  subjectKindOf,
} from "@/lib/artifacts/render-client";
import { getCorsHeaders } from "@/lib/cors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SLUG_RE = /^[a-z][a-z0-9_]*$/;
const VERSION_RE = /^v\d+$/;

/**
 * `GET /api/artifacts/as-of?slug=&subject_id=[&version=v1]`
 *
 * The pre-rendered vintages for one (slug, subject): each date, the formats
 * stored under it, and the object URI per format. Read-only — nothing is
 * rendered by asking.
 *
 * Why it exists: pre-rendered subject kinds (filers, cohorts) have no loader
 * inside render-svc, so a caller who did not already know the right date
 * could not render one of those artifacts at all. render-svc's error text
 * pointed at this route before it was served here, so callers were sent to a
 * 404. Cohort `as_of=latest` now resolves to the newest vintage in this list;
 * filers still need an explicit date from it.
 *
 * Authenticated (API key or session) but unmetered: it is discovery, but it
 * enumerates per-subject object paths rather than a static table, so it is
 * not left anonymous the way `/api/artifacts/capability` is.
 *
 * 404 when nothing is pre-rendered. The body says whether the slug is unbuilt
 * or the subject is unknown for a populated slug — the two have different
 * fixes and used to be indistinguishable.
 */
export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  const sp = request.nextUrl.searchParams;

  const slug = sp.get("slug")?.trim() ?? "";
  const subjectId = sp.get("subject_id")?.trim() ?? "";
  const version = sp.get("version")?.trim() || "v1";

  if (!slug || !SLUG_RE.test(slug)) {
    return NextResponse.json(
      {
        error: "invalid_request",
        message: "slug is required and must match ^[a-z][a-z0-9_]*$",
        usage: ARTIFACT_DISCOVERY_ROUTES.as_of,
      },
      { status: 400, headers: getCorsHeaders(origin) },
    );
  }
  if (!VERSION_RE.test(version)) {
    return NextResponse.json(
      { error: "invalid_request", message: "version must look like v1" },
      { status: 400, headers: getCorsHeaders(origin) },
    );
  }
  const subjectKind = subjectId ? subjectKindOf(subjectId) : null;
  if (!subjectId || !subjectKind) {
    return NextResponse.json(
      {
        error: "invalid_request",
        message:
          "subject_id is required and must carry a known prefix (BW-FUND-, BW-ETF-, BW-FILER-, BW-COHORT-, BW-STOCK-, BW-PORTFOLIO-)",
        usage: ARTIFACT_DISCOVERY_ROUTES.as_of,
      },
      { status: 400, headers: getCorsHeaders(origin) },
    );
  }

  const auth = await getBillingUserId(request);
  if (!auth) {
    return NextResponse.json(
      { error: "Unauthorized", message: "Valid API key or authentication required" },
      { status: 401, headers: getCorsHeaders(origin) },
    );
  }

  const result = await listArtifactVintages({ slug, subject_id: subjectId, version });
  if (!result.ok) {
    return NextResponse.json(
      { error: "upstream_error", message: result.error, detail: result.detail },
      { status: result.status, headers: getCorsHeaders(origin) },
    );
  }

  const headers = {
    ...getCorsHeaders(origin),
    // Listings change only when a pre-render job runs; short enough that a
    // new vintage is visible within minutes.
    "Cache-Control": "public, max-age=300, s-maxage=300",
  };

  if (result.count === 0) {
    const message = result.slug_populated
      ? `No pre-rendered ${slug}@${version} artifact for ${subjectId} under any known spelling of its id (searched ${result.subject_id_spellings_searched.join(", ")}). The slug is populated for other subjects, so the subject id is the problem.`
      : `${slug}@${version} is not pre-rendered for any subject. Check the slug against ${ARTIFACT_DISCOVERY_ROUTES.capability}.`;
    return NextResponse.json(
      {
        error: "not_found",
        message,
        slug,
        version,
        subject_id: subjectId,
        subject_kind: subjectKind,
        slug_populated: result.slug_populated,
        subject_id_spellings_searched: result.subject_id_spellings_searched,
        as_of: [],
        vintages: [],
        count: 0,
      },
      { status: 404, headers },
    );
  }

  return NextResponse.json(
    {
      slug: result.slug,
      version: result.version,
      subject_id: result.requested_subject_id,
      subject_kind: subjectKind,
      canonical_subject_id: result.canonical_subject_id,
      subject_id_spellings_searched: result.subject_id_spellings_searched,
      as_of_latest: latestResolutionFor(subjectKind),
      latest: result.latest,
      as_of: result.as_of,
      vintages: result.vintages,
      count: result.count,
    },
    { headers },
  );
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(request.headers.get("origin")),
  });
}
