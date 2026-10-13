import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// RFC 9207: every authorization response carries `iss`, equal to the issuer in
// the authorization-server metadata. Gemini CLI rejects a callback without it.

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "riskmodels.app", "x-forwarded-proto": "https" }),
}));
vi.mock("@/lib/oauth/server", async (orig) => {
  const real = await orig<typeof import("@/lib/oauth/server")>();
  return {
    ...real,
    getClient: vi.fn(async () => ({
      client_id: "rmc_test",
      redirect_uris: ["http://localhost:55406/oauth/callback"],
    })),
  };
});

import { POST } from "@/app/api/oauth/authorize/decision/route";
import { GET as metadata } from "@/app/.well-known/oauth-authorization-server/route";

function deny(): NextRequest {
  const form = new FormData();
  form.set("client_id", "rmc_test");
  form.set("redirect_uri", "http://localhost:55406/oauth/callback");
  form.set("state", "st-1");
  form.set("decision", "deny");
  return new NextRequest("https://riskmodels.app/api/oauth/authorize/decision", {
    method: "POST",
    body: form,
    headers: { origin: "https://riskmodels.app", host: "riskmodels.app" },
  });
}

describe("authorization response iss (RFC 9207)", () => {
  it("carries iss equal to the metadata issuer on a client redirect", async () => {
    const res = await POST(deny());
    expect(res.status).toBe(303);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.searchParams.get("error")).toBe("access_denied");
    expect(loc.searchParams.get("state")).toBe("st-1");
    const meta = await (await metadata()).json();
    expect(loc.searchParams.get("iss")).toBe(meta.issuer);
    expect(meta.authorization_response_iss_parameter_supported).toBe(true);
  });
});
