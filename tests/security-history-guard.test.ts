import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import * as path from "node:path";

/**
 * Regression guard for the pure-Zarr SSOT cutover: the Supabase `security_history`
 * table has been removed, and no DAL or route code may query it. `security_history_latest`
 * (the wide pipeline-maintained table) is explicitly allowed.
 *
 * If this test fails, the offending file is calling `.from("security_history")` (or
 * similar) — fix it by routing the read through `lib/dal/zarr-reader.ts` (range history,
 * rankings) or `security_history_latest` (wide latest row). Under no circumstances
 * re-introduce a Supabase EAV history query.
 */

const REPO_ROOT = path.resolve(__dirname, "..");
const SCAN_DIRS = ["lib/dal", "lib/agent", "lib/risk", "lib/portfolio", "lib/chat", "app/api"];

function grepSecurityHistoryCalls(): string[] {
  // Match `.from("security_history")` or `.from('security_history')`. The
  // pattern does NOT match `security_history_latest` (the wide table, which
  // is still allowed) because the literal requires the closing quote right
  // after `security_history`.
  const pattern = "\\.from\\(['\"]security_history['\"]\\)";
  const args = ["-RnE", pattern, ...SCAN_DIRS];
  try {
    // grep exits 0 on match, 1 on no match, 2 on error. `execFileSync` throws
    // on non-zero exit, so we catch the "no match" case and return empty.
    const out = execFileSync("grep", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    return out
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      // Skip lines that are themselves comments — documentation may
      // reference the removed pattern without calling it.
      .filter((l) => {
        // Line formats: "path/to/file.ts:123: code"
        const m = l.match(/^[^:]+:\d+:(.*)$/);
        const code = (m ? m[1] : l).trimStart();
        if (code.startsWith("//")) return false;
        if (code.startsWith("*")) return false; // JSDoc body line
        if (code.startsWith("/*")) return false;
        return true;
      });
  } catch (err: unknown) {
    const e = err as { status?: number; stderr?: string };
    if (e?.status === 1) return []; // grep "no match"
    throw new Error(
      `security_history guard grep failed (status=${e?.status}): ${e?.stderr ?? "unknown"}`,
    );
  }
}

describe("security_history guard (pure-Zarr SSOT)", () => {
  it("no DAL or route file calls .from(\"security_history\")", () => {
    const hits = grepSecurityHistoryCalls();
    if (hits.length > 0) {
      const msg = [
        "Found Supabase `security_history` queries in DAL/route code. This table has",
        "been removed as of the pure-Zarr SSOT cutover. Route the read through:",
        "  - lib/dal/zarr-reader.ts (range history, rankings)",
        "  - security_history_latest table (wide latest row)",
        "",
        "Offending lines:",
        ...hits.map((h) => `  ${h}`),
      ].join("\n");
      throw new Error(msg);
    }
    expect(hits).toEqual([]);
  });
});
