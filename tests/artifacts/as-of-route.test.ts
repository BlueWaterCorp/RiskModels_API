/**
 * `GET /api/artifacts/as-of` — the public pre-rendered vintage listing.
 *
 * render-svc's error text sent callers to this path before anything served it
 * (prod 2026-09-01: `No route matches GET /api/artifacts/as-of`). These tests
 * pin the contract the error text promises: the dates that exist, per format,
 * and a clean 404 that says unbuilt slug vs unknown subject.
 *
 * render-svc is mocked at the fetch boundary with the response shape its
 * `/artifacts/as-of` returns; auth is mocked so the route's own validation
 * order (400 before 401) is what is under test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ userId: "user-1" as string | null }));

vi.mock("@/lib/agent/billing-user", () => ({
  getBillingUserId: async () => (authState.userId ? { userId: authState.userId } : null),
}));

vi.mock("@/lib/artifacts/gcp-id-token", () => ({
  authorizationHeaderForCloudRun: async () => "Bearer test-id-token",
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/artifacts/as-of/route";

const BUCKET = "gs://example-bucket";

/** What prod render-svc lists for the three cohort subjects (2026-09-01). */
const PROD_VINTAGES: Record<string, { subject: string; date: string }> = {
  risk_dna_stacked: { subject: "BW-COHORT-RES-MAG7", date: "2026-04-21" },
  macro_correlation_arrows: { subject: "BW-COHORT-RES-MAG7", date: "2026-04-22" },
  lag_erosion: { subject: "BW-COHORT-RES-13F5", date: "2026-04-30" },
};

function renderSvcListing(slug: string, subject: string, dates: string[], slugPopulated = true) {
  const vintages = dates.map((d) => ({
    as_of: d,
    formats: ["json", "png"],
    params_variants: [],
    gcs_path: {
      json: `${BUCKET}/snapshots/artifacts/${slug}@v1/${subject}/${d}.json`,
      png: `${BUCKET}/snapshots/artifacts/${slug}@v1/${subject}/${d}.png`,
    },
  }));
  return {
    slug,
    version: "v1",
    requested_subject_id: subject,
    canonical_subject_id: subject,
    subject_id_spellings_searched: [subject],
    as_of: dates,
    latest: dates.length ? dates[dates.length - 1] : null,
    vintages,
    count: dates.length,
    slug_populated: slugPopulated || dates.length > 0,
  };
}

function mockRenderSvc(handler: (url: URL) => { status: number; body: unknown }) {
  const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const { status, body } = handler(url);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const req = (qs: string) =>
  new NextRequest(`https://riskmodels.app/api/artifacts/as-of${qs}`, {
    headers: { Authorization: "Bearer rm_test_key" },
  });

describe("GET /api/artifacts/as-of", () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env.RENDER_SVC_URL;

  beforeEach(() => {
    process.env.RENDER_SVC_URL = "https://render.example.run.app";
    authState.userId = "user-1";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalEnv === undefined) delete process.env.RENDER_SVC_URL;
    else process.env.RENDER_SVC_URL = originalEnv;
    vi.restoreAllMocks();
  });

  it("returns the pre-rendered date for each of the three prod cohort artifacts", async () => {
    const fetchMock = mockRenderSvc((url) => {
      const slug = url.searchParams.get("slug")!;
      const subject = url.searchParams.get("subject_id")!;
      const known = PROD_VINTAGES[slug];
      if (known && known.subject === subject) {
        return { status: 200, body: renderSvcListing(slug, subject, [known.date]) };
      }
      return { status: 200, body: renderSvcListing(slug, subject, [], false) };
    });

    for (const [slug, { subject, date }] of Object.entries(PROD_VINTAGES)) {
      const res = await GET(req(`?slug=${slug}&subject_id=${subject}`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.slug).toBe(slug);
      expect(body.subject_id).toBe(subject);
      expect(body.subject_kind).toBe("cohort");
      expect(body.as_of).toEqual([date]);
      expect(body.latest).toBe(date);
      expect(body.count).toBe(1);
      // Cohort `latest` on the render call resolves to this list's newest date.
      expect(body.as_of_latest).toBe("newest_prerendered");
      expect(body.vintages).toHaveLength(1);
      expect(body.vintages[0].as_of).toBe(date);
      expect(body.vintages[0].formats).toEqual(["json", "png"]);
      expect(body.vintages[0].gcs_path.png).toBe(
        `${BUCKET}/snapshots/artifacts/${slug}@v1/${subject}/${date}.png`,
      );
    }

    // Every call went upstream to render-svc's as-of listing with the ID token.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      const url = new URL(String(call[0]));
      expect(url.pathname).toBe("/artifacts/as-of");
      expect(url.searchParams.get("version")).toBe("v1");
      const init = call[1] as RequestInit;
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-id-token");
    }
  });

  it("404s cleanly on an unknown slug and says the slug is unbuilt", async () => {
    mockRenderSvc((url) => ({
      status: 200,
      body: renderSvcListing(
        url.searchParams.get("slug")!,
        url.searchParams.get("subject_id")!,
        [],
        false,
      ),
    }));

    const res = await GET(req("?slug=no_such_slug&subject_id=BW-COHORT-RES-MAG7"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not_found");
    expect(body.slug_populated).toBe(false);
    expect(body.message).toContain("not pre-rendered for any subject");
    expect(body.as_of).toEqual([]);
    expect(body.count).toBe(0);
  });

  it("404s on an unknown subject for a populated slug and names the id", async () => {
    mockRenderSvc((url) => ({
      status: 200,
      body: renderSvcListing(
        url.searchParams.get("slug")!,
        url.searchParams.get("subject_id")!,
        [],
        true,
      ),
    }));

    const res = await GET(req("?slug=risk_dna_stacked&subject_id=BW-COHORT-RES-NOPE"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.slug_populated).toBe(true);
    expect(body.message).toContain("BW-COHORT-RES-NOPE");
    expect(body.message).toContain("subject id is the problem");
  });

  it("filer subjects are told latest is unsupported and given the dates", async () => {
    mockRenderSvc(() => ({
      status: 200,
      body: {
        ...renderSvcListing("entity_header", "BW-FILER-0001067983", ["2025-12-31", "2026-03-31"]),
        requested_subject_id: "BW-FILER-CIK0001067983",
        subject_id_spellings_searched: ["BW-FILER-0001067983", "BW-FILER-CIK0001067983"],
      },
    }));

    const res = await GET(req("?slug=entity_header&subject_id=BW-FILER-CIK0001067983"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subject_kind).toBe("filer_13f");
    expect(body.as_of_latest).toBe("unsupported");
    expect(body.latest).toBe("2026-03-31");
    expect(body.canonical_subject_id).toBe("BW-FILER-0001067983");
  });

  it("400s on a missing or malformed slug before touching auth or render-svc", async () => {
    authState.userId = null;
    const fetchMock = mockRenderSvc(() => ({ status: 200, body: {} }));

    for (const qs of ["?subject_id=BW-COHORT-RES-MAG7", "?slug=../x&subject_id=BW-COHORT-RES-MAG7"]) {
      const res = await GET(req(qs));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_request");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400s on a subject_id with no known prefix", async () => {
    const fetchMock = mockRenderSvc(() => ({ status: 200, body: {} }));
    const res = await GET(req("?slug=risk_dna_stacked&subject_id=MAG7"));
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain("known prefix");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("401s without a valid key or session", async () => {
    authState.userId = null;
    const fetchMock = mockRenderSvc(() => ({ status: 200, body: {} }));
    const res = await GET(req("?slug=risk_dna_stacked&subject_id=BW-COHORT-RES-MAG7"));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates an upstream failure with its status rather than masking it", async () => {
    mockRenderSvc(() => ({ status: 503, body: { detail: "not ready: store" } }));
    const res = await GET(req("?slug=risk_dna_stacked&subject_id=BW-COHORT-RES-MAG7"));
    expect(res.status).toBe(503);
    expect((await res.json()).message).toContain("not ready");
  });

  it("503s when RENDER_SVC_URL is unset", async () => {
    delete process.env.RENDER_SVC_URL;
    const res = await GET(req("?slug=risk_dna_stacked&subject_id=BW-COHORT-RES-MAG7"));
    expect(res.status).toBe(503);
  });
});
