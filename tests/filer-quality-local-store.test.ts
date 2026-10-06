import { describe, expect, it } from "vitest";
import {
  readFilerDataVintage,
  readFilerPortfolioSeries,
  readFilerVintageQuarters,
} from "@/lib/dal/funds-zarr-reader";
import { annotatePortfolioRows } from "@/lib/13f/filer-portfolio-quality";

// Runs only against real stores (ZARR_FUNDS_LOCAL_ROOT=<Funds_DAG_data>/sec_data/zarr). The equality gate in
// annotatePortfolioRows must pass on every quarter of filers with amendments: the vintage book's filing date equals
// the portfolio row's filing date.
describe.skipIf(!process.env.ZARR_FUNDS_LOCAL_ROOT)("filer quality fields against the local stores", () => {
  it.each(["BW-FILER-CIK0001067983", "BW-FILER-CIK0001207017", "BW-FILER-CIK0001009207"])(
    "%s: every quarter's book matches its row",
    async (id) => {
      const rows = await readFilerPortfolioSeries(id);
      const [v, dv] = await Promise.all([readFilerVintageQuarters(id), readFilerDataVintage(id)]);
      expect(rows.length).toBeGreaterThan(40);
      const out = annotatePortfolioRows(rows, v, null, dv?.returns_window_end ?? null);
      expect(out.book_mismatches).toBe(0);
      expect(out.rows.every((r) => r.accession_number != null)).toBe(true);
    },
    120_000,
  );
});
