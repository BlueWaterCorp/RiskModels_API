/**
 * The TypeScript param vocabularies must equal render-svc's, byte for byte.
 *
 * Before 2026-08-02 four vocabularies of different widths described the same
 * `params` field: render-svc accepted seven keys, `render-client.ts` typed
 * three, `.net`'s client typed two, and `.net`'s image route allowlisted two
 * and silently dropped the rest (G.54). Nothing failed, because nothing
 * compared them.
 *
 * render-svc's source lives in THIS repo, so the comparison needs no cross-repo
 * machinery — parse the Python literals and assert. A test that reads the other
 * definition is the difference between reconciling once and reconciling again.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ARTIFACT_PARAM_KEYS,
  ARTIFACT_SLUG_PARAMS,
  ARTIFACT_SUBJECT_KINDS,
} from "@/lib/artifacts/render-client";
import { artifactRenderParamsSchema } from "@/lib/artifacts/render-params-schema";

const ARTIFACTS_PY = join(
  process.cwd(),
  "services/render-svc/render_svc/artifacts.py",
);

const source = readFileSync(ARTIFACTS_PY, "utf8");

/** Body of a `name: <type> = { … }` / `name: <type> = ( … )` literal. */
function pythonLiteralBody(name: string, open: "{" | "("): string {
  const close = open === "{" ? "}" : ")";
  const start = source.indexOf(`${name}:`);
  expect(start, `${name} not found in artifacts.py`).toBeGreaterThan(-1);
  const openIdx = source.indexOf(open, start);
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    if (source[i] === open) depth++;
    else if (source[i] === close) {
      depth--;
      if (depth === 0) return source.slice(openIdx + 1, i);
    }
  }
  throw new Error(`unterminated ${name} literal`);
}

/** `_SLUG_PARAMS` as {slug: sorted param names}, parsed from the Python source. */
function parseSlugParams(): Record<string, string[]> {
  const body = pythonLiteralBody("_SLUG_PARAMS", "{");
  const out: Record<string, string[]> = {};
  const entry = /"([a-z0-9_]+)":\s*frozenset\(\{([^}]*)\}\)/g;
  let m: RegExpExecArray | null;
  while ((m = entry.exec(body)) !== null) {
    out[m[1]] = [...m[2].matchAll(/"([a-z0-9_]+)"/g)]
      .map((k) => k[1])
      .sort();
  }
  return out;
}

describe("render-svc param contract", () => {
  it("ARTIFACT_SLUG_PARAMS equals _SLUG_PARAMS in artifacts.py", () => {
    const python = parseSlugParams();
    expect(Object.keys(python).length).toBeGreaterThan(0);

    const ts = Object.fromEntries(
      Object.entries(ARTIFACT_SLUG_PARAMS).map(([slug, keys]) => [
        slug,
        [...keys].sort(),
      ]),
    );
    expect(ts).toEqual(python);
  });

  it("ARTIFACT_PARAM_KEYS equals the ArtifactParams model fields", () => {
    // Field declarations inside `class ArtifactParams`, up to the next class.
    const classStart = source.indexOf("class ArtifactParams(BaseModel):");
    expect(classStart).toBeGreaterThan(-1);
    const classEnd = source.indexOf("\nclass ", classStart + 1);
    const body = source.slice(classStart, classEnd);
    const fields = [...body.matchAll(/^ {4}([a-z_][a-z0-9_]*):\s/gm)]
      .map((m) => m[1])
      .filter((f) => f !== "model_config");

    expect([...ARTIFACT_PARAM_KEYS].sort()).toEqual([...fields].sort());
  });

  it("the zod shape covers exactly the declared param keys", () => {
    expect(Object.keys(artifactRenderParamsSchema.shape).sort()).toEqual(
      [...ARTIFACT_PARAM_KEYS].sort(),
    );
  });

  it("every param key applies to at least one slug", () => {
    const used = new Set(Object.values(ARTIFACT_SLUG_PARAMS).flat());
    for (const key of ARTIFACT_PARAM_KEYS) {
      expect(used, `${key} applies to no slug — dead vocabulary`).toContain(key);
    }
  });

  it("window accepts every value render-svc's request schema declares", () => {
    const literal = source.match(
      /window:\s*Literal\[([^\]]+)\]/,
    );
    expect(literal).not.toBeNull();
    const pythonWindows = [...literal![1].matchAll(/"([a-z0-9]+)"/g)]
      .map((m) => m[1])
      .sort();
    const zodWindows = [
      ...artifactRenderParamsSchema.shape.window.unwrap().options,
    ].sort();
    expect(zodWindows).toEqual(pythonWindows);
  });

  it("ARTIFACT_SUBJECT_KINDS equals _SUBJECT_PREFIX_KIND's values", () => {
    const body = pythonLiteralBody("_SUBJECT_PREFIX_KIND", "{");
    const kinds = [...body.matchAll(/:\s*"([a-z0-9_]+)"/g)]
      .map((m) => m[1])
      .sort();
    expect([...ARTIFACT_SUBJECT_KINDS].sort()).toEqual(kinds);
  });
});

describe("agent capability registry", () => {
  /**
   * The registry entry for `artifact-render` is a fifth vocabulary. It named
   * two slugs and two params while render-svc enforced seven params across ten
   * slugs, so an agent reading `GET /capabilities` could not learn that
   * `layers`, `benchmark`, `peer_n`, `sort_by` or `date` existed at all (G.54).
   *
   * It is spelled out rather than imported — `generate-mcp-capabilities.mjs`
   * bundles and evaluates `lib/agent/capabilities.ts`, and importing the render
   * client would pull GCP auth into that build. This test is what makes the
   * copy safe.
   */
  it("describes exactly the slugs and params render-svc enforces", async () => {
    const { ARTIFACT_RENDER_PARAMS_DESCRIPTION } = await import(
      "@/lib/agent/capabilities"
    );
    for (const [slug, keys] of Object.entries(ARTIFACT_SLUG_PARAMS)) {
      expect(
        ARTIFACT_RENDER_PARAMS_DESCRIPTION,
        `${slug} missing or wrong in the capability description`,
      ).toContain(`${slug}: ${[...keys].sort().join("+")}`);
    }
    for (const key of ARTIFACT_PARAM_KEYS) {
      expect(ARTIFACT_RENDER_PARAMS_DESCRIPTION).toContain(key);
    }
    // No slug may be described that render-svc does not parameterize. Read the
    // applicability clause only — the surrounding prose contains colons too.
    const clause = ARTIFACT_RENDER_PARAMS_DESCRIPTION.split("Applicability — ")[1]
      ?.split(". Every other slug")[0];
    expect(clause, "applicability clause not found").toBeTruthy();
    const described = clause!.split("; ").map((pair) => pair.split(":")[0]);
    expect(described.sort()).toEqual(Object.keys(ARTIFACT_SLUG_PARAMS).sort());
  });

  it("keeps the generated capabilities.json in step with the registry", () => {
    const generated = JSON.parse(
      readFileSync(join(process.cwd(), "mcp/data/capabilities.json"), "utf8"),
    ) as Array<{ id: string; parameters?: Record<string, { description?: string }> }>;
    const render = generated.find((c) => c.id === "artifact-render");
    expect(render, "artifact-render capability missing").toBeDefined();
    expect(render!.parameters?.params?.description).toContain("holdings_active_panel: benchmark+top_n");
  });
});
