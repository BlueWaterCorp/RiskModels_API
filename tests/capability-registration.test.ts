/**
 * Every capabilityId a route declares must exist in the capability registry.
 *
 * withBilling looks the id up AFTER authenticating and returns 400 "Unknown
 * capability" when it is missing (lib/agent/billing-middleware.ts). So a route
 * with an unregistered id type-checks, builds, deploys, and then fails every
 * single authenticated request.
 *
 * That is exactly what shipped in #380: /api/weekly-hedge passed tsc, passed
 * next build, passed its own unit tests, and could not serve one call. Nothing
 * in the pipeline looks across the route/registry boundary — so this does.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { getCapability } from "@/lib/agent/capabilities";

const API_ROOT = join(process.cwd(), "app/api");

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...routeFiles(p));
    else if (entry === "route.ts" || entry === "route.tsx") out.push(p);
  }
  return out;
}

/** Routes with skipBilling never reach the 400 check — the lookup there only
 *  sets an optional pricing header, and it is already guarded. */
function skipsBilling(src: string): boolean {
  return /skipBilling:\s*true/.test(src);
}

/** `{ capabilityId: "x" }` / `capabilityId: 'x'` as written in withBilling opts. */
function declaredCapabilityIds(src: string): string[] {
  const ids = new Set<string>();
  for (const m of src.matchAll(/capabilityId:\s*["'`]([^"'`]+)["'`]/g)) {
    if (m[1]) ids.add(m[1]);
  }
  return [...ids];
}

describe("route capabilityIds are registered", () => {
  const files = routeFiles(API_ROOT);

  it("finds routes to check", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  const declaring = files
    .map((f) => {
      const src = readFileSync(f, "utf8");
      return { f, ids: skipsBilling(src) ? [] : declaredCapabilityIds(src) };
    })
    .filter((x) => x.ids.length > 0);

  it("finds routes that declare a capability", () => {
    expect(declaring.length).toBeGreaterThan(5);
  });

  for (const { f, ids } of declaring) {
    const rel = f.slice(process.cwd().length + 1);
    for (const id of ids) {
      it(`${rel} → "${id}" resolves`, () => {
        expect(
          getCapability(id),
          `Route ${rel} declares capabilityId "${id}", which is not in ` +
            `lib/agent/capabilities.ts. withBilling will 400 "Unknown ` +
            `capability" on every authenticated request to it.`,
        ).toBeTruthy();
      });
    }
  }
});
