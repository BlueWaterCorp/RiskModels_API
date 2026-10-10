import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PortfolioExposureRequestSchema } from "@/lib/api/schemas";

/**
 * Real long/short mutual-fund books (SEC N-PORT, via Funds_DAG) for exercising
 * POST /api/portfolio/exposure. Each file must stay a valid request body.
 */

const DIR = join(__dirname, "fixtures", "long-short-books");
const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));

describe("long/short book fixtures", () => {
  it("has the four books", () => {
    expect(files.sort()).toEqual([
      "aqr_sustainable_ls.json",
      "boston_partners_ls_research.json",
      "federated_mdt_market_neutral.json",
      "vanguard_market_neutral.json",
    ]);
  });

  for (const file of files) {
    it(`${file} is a valid exposure request with longs and shorts`, () => {
      const book = JSON.parse(readFileSync(join(DIR, file), "utf8"));
      const parsed = PortfolioExposureRequestSchema.safeParse({ positions: book.positions });
      expect(parsed.success).toBe(true);
      const values: number[] = book.positions.map((p: { value: number }) => p.value);
      expect(values.some((v) => v > 0)).toBe(true);
      expect(values.some((v) => v < 0)).toBe(true);
    });
  }
});
