import { afterEach, describe, expect, it, vi } from "vitest";

import { renderArtifact } from "@/lib/artifacts/render-client";

describe("renderArtifact", () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env.RENDER_SVC_URL;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalEnv === undefined) {
      delete process.env.RENDER_SVC_URL;
    } else {
      process.env.RENDER_SVC_URL = originalEnv;
    }
    vi.restoreAllMocks();
  });

  it("returns 503 when RENDER_SVC_URL is unset", async () => {
    delete process.env.RENDER_SVC_URL;
    const result = await renderArtifact({
      slug: "narrative_profile",
      subject_id: "BW-FUND-S000004563",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
    }
  });

  it("parses JSON success from render-svc", async () => {
    process.env.RENDER_SVC_URL = "https://render.example.run.app";
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ slug: "narrative_profile", text: "Profile: …" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Artifact-Resolved-As-Of": "2025-11-30",
          "X-Artifact-GCS-Path": "snapshots/artifacts/narrative_profile@v1/BW-FUND-X/2025-11-30.json",
          "X-Artifact-Receipt-Id": "abc12345",
        },
      }),
    );

    const result = await renderArtifact({
      slug: "narrative_profile",
      subject_id: "BW-FUND-S000004563",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolved_as_of).toBe("2025-11-30");
      expect(result.receipt_id).toBe("abc12345");
      expect((result.data as { slug: string }).slug).toBe("narrative_profile");
    }
  });
});
