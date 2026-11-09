import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const script = join(process.cwd(), "scripts/check-silent-defaults.mjs");

describe("check-silent-defaults", () => {
  it("rejects an unflagged numeric fallback in a sample source file", () => {
    const dir = mkdtempSync(join(tmpdir(), "silent-defaults-"));
    const sample = join(dir, "sample.ts");
    writeFileSync(sample, "const modelValue = row.value ?? 0;\n");

    const result = spawnSync(process.execPath, [script, sample], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("sample.ts:1");
  });

  it("accepts a reasoned control-flow exception in a sample source file", () => {
    const dir = mkdtempSync(join(tmpdir(), "silent-defaults-"));
    const sample = join(dir, "sample.ts");
    writeFileSync(
      sample,
      "const offset = options.offset ?? 0; // allow-default: omitted pagination offset starts at zero\n",
    );

    expect(() => execFileSync(process.execPath, [script, sample])).not.toThrow();
  });

  it("does not confuse a nonzero decimal assumption with an exact zero fallback", () => {
    const dir = mkdtempSync(join(tmpdir(), "silent-defaults-"));
    const sample = join(dir, "sample.ts");
    writeFileSync(sample, "const documentedAssumption = options.value ?? 0.05;\n");

    expect(() => execFileSync(process.execPath, [script, sample])).not.toThrow();
  });
});
