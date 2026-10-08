import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@react-email/render";

const PROPS = {
  firstName: "Ada",
  keyName: "default",
  keyPrefix: "rm_agent_live_abcd",
  createdDateFormatted: "October 8, 2026",
  expiresAtFormatted: "October 8, 2027",
  termsUrl: "https://riskmodels.net/terms/api",
};

async function renderKeyIssued(): Promise<string> {
  vi.resetModules();
  const { KeyIssuedEmail } = await import("@/emails/key-issued");
  return render(KeyIssuedEmail(PROPS));
}

describe("email links", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("points docs links at riskmodels.app even when NEXT_PUBLIC_APP_URL is .net", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://riskmodels.net");
    const html = await renderKeyIssued();

    for (const path of ["/api-docs", "/quickstart", "/get-key", "/docs/authentication", "/account/usage"]) {
      expect(html).toContain(`https://riskmodels.app${path}`);
      expect(html).not.toContain(`https://riskmodels.net${path}`);
    }
  });

  it("links pages that exist and describes cost reporting accurately", async () => {
    const html = await renderKeyIssued();

    expect(html).toContain("https://riskmodels.app/openapi.json");
    expect(html).toContain("https://riskmodels.app/api/health");
    expect(html).not.toContain("riskmodels.app/schemas");
    expect(html).not.toContain("riskmodels.app/status");

    expect(html).toContain("X-API-Cost-USD");
    expect(html).not.toContain("_cost_usd");
  });

  it("sends account settings and support links to the .net account app", async () => {
    vi.resetModules();
    const { SUPPORT_URL, ACCOUNT_SITE_URL, BASE_URL } = await import("@/emails/constants");
    expect(BASE_URL).toBe("https://riskmodels.app");
    expect(ACCOUNT_SITE_URL).toBe("https://riskmodels.net");
    expect(SUPPORT_URL).toBe("https://riskmodels.net/support");
  });
});
