import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const script = join(process.cwd(), "scripts/check-silent-defaults.mjs");

describe("check-silent-defaults", () => {
  function check(source: string) {
    const dir = mkdtempSync(join(tmpdir(), "silent-defaults-"));
    const sample = join(dir, "sample.ts");
    writeFileSync(sample, source);
    return spawnSync(process.execPath, [script, sample], { encoding: "utf8" });
  }

  it.each([
    ["nullish zero", "const value = row.value ?? 0;"],
    ["nullish decimal zero", "const value = row.value ?? 0.0;"],
    ["parenthesized zero", "const value = row.value ?? (0);"],
    ["logical zero", "const value = row.value || 0;"],
    ["nullish one", "const value = row.value ?? 1;"],
    ["logical one", "const value = row.value || 1;"],
    ["multiline fallback", "const value = row.value ??\n  (0);"],
    ["null ternary", "const value = row.value == null ? 0 : row.value;"],
    ["finite ternary", "const value = Number.isFinite(row.value) ? row.value : 0;"],
    ["destructuring default", "const { market_er = 0 } = row;"],
  ])("rejects %s", (_label, source) => {
    const result = check(`${source}\n`);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("sample.ts:1");
  });

  it("accepts a categorized, reasoned control-flow exception", () => {
    const result = check(
      "const offset = options.offset ?? 0; // allow-default: pagination - omitted offset starts at zero\n",
    );
    expect(result.status).toBe(0);
  });

  it.each([
    "const value = row.value ?? 0; // any comment\n",
    "const value = row.value ?? 0; // allow-default: because it is okay\n",
    "const value = row.value ?? 0; // allow-default: made-up - reason\n",
    "const value = row.value ?? 0; // allow-default: counter\n",
  ])("rejects a nonspecific allowlist entry", (source) => {
    expect(check(source).status).toBe(1);
  });

  it("does not confuse a nonzero decimal assumption with an exact zero fallback", () => {
    const dir = mkdtempSync(join(tmpdir(), "silent-defaults-"));
    const sample = join(dir, "sample.ts");
    writeFileSync(sample, "const documentedAssumption = options.value ?? 0.05;\n");

    expect(() => execFileSync(process.execPath, [script, sample])).not.toThrow();
  });
});
