/**
 * OpenBB Workspace CORS + credential extraction.
 *
 * Contract origins (must echo Allow-Origin, never a different host):
 *   https://pro.openbb.co, https://pro.openbb.dev, http://localhost:1420
 */
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import {
  isOpenBBOrigin,
  normalizeOpenBBOrigin,
  openbbCors,
} from "@/app/openbb/_lib/cors";
import { bearerFromRequest } from "@/app/openbb/_lib/upstream";

function corsFor(origin: string, extra?: Record<string, string>) {
  return openbbCors(
    new NextRequest("https://riskmodels.app/openbb/widgets.json", {
      headers: { origin, ...extra },
    }),
  );
}

describe("isOpenBBOrigin", () => {
  it("allows the contract origins, including trailing slashes", () => {
    for (const o of [
      "https://pro.openbb.co",
      "https://pro.openbb.co/",
      "https://pro.openbb.dev",
      "https://pro.openbb.dev/",
      "http://localhost:1420",
    ]) {
      expect(isOpenBBOrigin(o), o).toBe(true);
    }
  });

  it("allows other OpenBB Workspace hosts and nested subdomains", () => {
    expect(isOpenBBOrigin("https://my.openbb.co")).toBe(true);
    expect(isOpenBBOrigin("https://excel.openbb.co")).toBe(true);
    expect(isOpenBBOrigin("https://app.pro.openbb.co")).toBe(true);
  });

  it("rejects unrelated origins", () => {
    expect(isOpenBBOrigin("https://evil.example")).toBe(false);
    expect(isOpenBBOrigin("https://openbb.com")).toBe(false);
    expect(isOpenBBOrigin("http://pro.openbb.co")).toBe(false);
  });
});

describe("openbbCors", () => {
  it("echoes pro.openbb.co and pro.openbb.dev (Minh 2026-08-19 request)", () => {
    expect(corsFor("https://pro.openbb.co")["Access-Control-Allow-Origin"]).toBe(
      "https://pro.openbb.co",
    );
    expect(corsFor("https://pro.openbb.dev")["Access-Control-Allow-Origin"]).toBe(
      "https://pro.openbb.dev",
    );
  });

  it("strips trailing slashes before echoing", () => {
    expect(normalizeOpenBBOrigin("https://pro.openbb.dev/")).toBe(
      "https://pro.openbb.dev",
    );
    expect(corsFor("https://pro.openbb.dev/")["Access-Control-Allow-Origin"]).toBe(
      "https://pro.openbb.dev",
    );
  });

  it("does not substitute pro.openbb.co when the origin is disallowed", () => {
    const headers = corsFor("https://evil.example");
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("echoes Access-Control-Request-Headers on preflight", () => {
    const headers = corsFor("https://pro.openbb.co", {
      "access-control-request-headers": "x-api-key, x-openbb-user, x-trace-id",
    });
    expect(headers["Access-Control-Allow-Headers"]).toBe(
      "x-api-key, x-openbb-user, x-trace-id",
    );
    expect(headers["Access-Control-Allow-Credentials"]).toBe("true");
  });

  it("defaults Allow-Origin to pro.openbb.co when Origin is absent", () => {
    const headers = openbbCors(
      new NextRequest("https://riskmodels.app/openbb/widgets.json"),
    );
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://pro.openbb.co");
  });
});

describe("bearerFromRequest", () => {
  it("reads X-API-KEY", () => {
    const req = new NextRequest("https://riskmodels.app/openbb/widgets/metrics", {
      headers: { "x-api-key": "rm_agent_live_abc" },
    });
    expect(bearerFromRequest(req)).toBe("rm_agent_live_abc");
  });

  it("reads Authorization Bearer", () => {
    const req = new NextRequest("https://riskmodels.app/openbb/widgets/metrics", {
      headers: { authorization: "Bearer rm_agent_live_abc" },
    });
    expect(bearerFromRequest(req)).toBe("rm_agent_live_abc");
  });

  it("reads OpenBB query-string api_key when no header is set", () => {
    const req = new NextRequest(
      "https://riskmodels.app/openbb/widgets/metrics?ticker=AAPL&api_key=rm_agent_live_abc",
    );
    expect(bearerFromRequest(req)).toBe("rm_agent_live_abc");
  });

  it("prefers the header over a query param", () => {
    const req = new NextRequest(
      "https://riskmodels.app/openbb/widgets/metrics?api_key=from-query",
      { headers: { "x-api-key": "from-header" } },
    );
    expect(bearerFromRequest(req)).toBe("from-header");
  });
});
