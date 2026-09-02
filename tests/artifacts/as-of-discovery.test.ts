/**
 * The as-of listing must be reachable from every discovery surface, not just
 * served: `riskmodels_list_endpoints` reads `mcp/data/capabilities.json`, the
 * passthrough allow-list is derived from the same file, and the capability
 * document is what a client reads before forming a render. Before this, the
 * route was named in error text and absent from all three, so the MCP
 * passthrough refused it as "not an invocable capability".
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CAPABILITIES } from "@/lib/agent/capabilities";
import {
  ARTIFACT_DISCOVERY_ROUTES,
  buildArtifactCapability,
  latestResolutionFor,
  PRERENDERED_SUBJECT_KINDS,
  STORE_RESOLVED_LATEST_KINDS,
} from "@/lib/artifacts/render-client";
import { buildPassthroughAllowlist, normalizeApiPath } from "@/lib/mcp/tools/riskmodels-tools";

const servedCapabilities = JSON.parse(
  readFileSync(join(process.cwd(), "mcp", "data", "capabilities.json"), "utf8"),
) as Array<{ id: string; method: string; endpoint: string; pricing?: { cost_usd?: number } }>;

describe("artifact-as-of capability", () => {
  it("is registered in the source registry as a free GET", () => {
    const cap = CAPABILITIES.find((c) => c.id === "artifact-as-of");
    expect(cap).toBeDefined();
    expect(cap!.method).toBe("GET");
    expect(cap!.endpoint).toBe("/artifacts/as-of");
    expect(cap!.pricing.cost_usd).toBe(0);
    expect(cap!.parameters.slug.required).toBe(true);
    expect(cap!.parameters.subject_id.required).toBe(true);
  });

  it("is present in the served capabilities.json so list_endpoints advertises it", () => {
    // The served file is generated from the registry (npm run build:capabilities);
    // a registry entry that never reached it would be advertised nowhere.
    const served = servedCapabilities.find((c) => c.id === "artifact-as-of");
    expect(served).toBeDefined();
    expect(served!.method).toBe("GET");
    expect(served!.endpoint).toBe("/artifacts/as-of");
  });

  it("is dispatchable through the MCP passthrough allow-list", () => {
    const allowlist = buildPassthroughAllowlist(servedCapabilities);
    for (const raw of [
      "/artifacts/as-of",
      "/api/artifacts/as-of",
      "/artifacts/as-of?slug=risk_dna_stacked&subject_id=BW-COHORT-RES-MAG7",
    ]) {
      const norm = normalizeApiPath(raw);
      expect(
        allowlist.some((a) => a.method === "GET" && a.re.test(norm)),
        `${raw} should be an invocable capability`,
      ).toBe(true);
    }
    // POST is not a registered method for it.
    expect(
      allowlist.some((a) => a.method === "POST" && a.re.test("/artifacts/as-of")),
    ).toBe(false);
  });
});

describe("capability document names the as-of route", () => {
  const doc = buildArtifactCapability();

  it("lists both discovery routes", () => {
    expect(doc.discovery).toEqual(ARTIFACT_DISCOVERY_ROUTES);
    expect(doc.discovery.as_of).toContain("/api/artifacts/as-of");
    expect(doc.discovery.capability).toContain("/api/artifacts/capability");
  });

  it("marks cohort pairs as resolving latest from the store and filers as unsupported", () => {
    expect(doc.store_resolved_latest_kinds).toEqual(STORE_RESOLVED_LATEST_KINDS);
    const cohort = doc.pairs.filter((p) => p.subject_kind === "cohort");
    expect(cohort.length).toBeGreaterThan(0);
    for (const p of cohort) expect(p.as_of_latest).toBe("newest_prerendered");
    for (const p of doc.pairs.filter((p) => p.subject_kind === "filer_13f")) {
      expect(p.as_of_latest).toBe("unsupported");
    }
    for (const p of doc.pairs.filter((p) => !PRERENDERED_SUBJECT_KINDS.includes(p.subject_kind))) {
      expect(p.as_of_latest).toBe("loader");
    }
  });

  it("keeps the three prod cohort slugs advertised as cohort-verified", () => {
    for (const slug of ["risk_dna_stacked", "macro_correlation_arrows", "lag_erosion"]) {
      const pair = doc.pairs.find((p) => p.slug === slug && p.subject_kind === "cohort");
      expect(pair, `${slug}/cohort`).toBeDefined();
      expect(pair!.prerendered).toBe(true);
      expect(pair!.as_of_latest).toBe("newest_prerendered");
    }
  });

  it("latestResolutionFor covers every kind exactly once", () => {
    expect(latestResolutionFor("cohort")).toBe("newest_prerendered");
    expect(latestResolutionFor("filer_13f")).toBe("unsupported");
    expect(latestResolutionFor("fund")).toBe("loader");
    expect(latestResolutionFor("stock")).toBe("loader");
  });
});
