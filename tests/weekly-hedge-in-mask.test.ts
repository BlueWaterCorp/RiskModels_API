/**
 * The weekly hedge feed ships in-mask names only.
 *
 * The store is written across the full symbol axis, but only names modelled for
 * the week carry hedge ratios — on 2026-09-21 that was 2,816 of 7,896. The rest
 * are empty in every column that matters. Shipping them would make the frame
 * 64% nulls, and since the axis is rebuilt weekly there is nothing stable to
 * join them against.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SRC = readFileSync(join(process.cwd(), "lib/dal/zarr-reader.ts"), "utf8");

function readerBody(): string {
  const start = SRC.indexOf("export async function readWeeklyHedgeSnapshot");
  expect(start).toBeGreaterThan(-1);
  return SRC.slice(start);
}

describe("weekly hedge in-mask filter", () => {
  it("skips rows with no hedge ratio", () => {
    const body = readerBody();
    expect(body).toContain("hasAnyHedgeRatio");
    expect(body).toMatch(/if \(!hasAnyHedgeRatio\) return;/);
  });

  it("selects on the hedge ratio itself, not a proxy", () => {
    // lstar_level > 0 happens to agree today. The hedge ratio is what the
    // caller came for, so that is what decides whether a row is worth sending.
    const body = readerBody();
    const guard = body.slice(body.indexOf("hasAnyHedgeRatio"), body.indexOf("if (!hasAnyHedgeRatio)"));
    expect(guard).toContain('endsWith("_HR")');
  });

  it("still stamps metadata on the rows it keeps", () => {
    const body = readerBody();
    for (const f of ["effective_from", "computed_through", "refit_grid", "universe"]) {
      expect(body).toContain(`row.${f} = metadata.${f}`);
    }
  });

  it("builds by push, so a skipped row is absent rather than undefined", () => {
    // A map() with an early return would leave holes in the array.
    const body = readerBody();
    expect(body).toContain("rows.push(row)");
    expect(body).not.toMatch(/const rows: WeeklyHedgeRow\[\] = symbols\.map/);
  });
});
