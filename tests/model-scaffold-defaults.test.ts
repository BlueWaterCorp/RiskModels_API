import { readFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildWorkbook } from "@/app/api/fundamentals/[ticker]/model-scaffold/route";

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), "tests/fixtures/fundamentals/aapl-row-2026-06-30.json"), "utf8"),
) as { row: Record<string, unknown> };

describe("model scaffold assumption disclosure", () => {
  it("states both documented defaults inside the workbook", async () => {
    const workbook = buildWorkbook(
      "AAPL",
      [fixture.row],
      "2026-10-01",
      0.05,
      0.21,
      ["erp", "tax_rate"],
    );
    const bytes = await workbook.xlsx.writeBuffer();
    const reloaded = new ExcelJS.Workbook();
    await reloaded.xlsx.load(bytes);

    const sheet = reloaded.getWorksheet("WACC build")!;
    expect(sheet.getCell("A16").value).toBe("assumptions_defaulted");
    expect(sheet.getCell("B16").value).toBe("erp, tax_rate");
  });

  it("keeps the disclosure empty when both assumptions are caller supplied", () => {
    const workbook = buildWorkbook(
      "AAPL",
      [fixture.row],
      "2026-10-01",
      0.06,
      0.24,
      [],
    );
    expect(workbook.getWorksheet("WACC build")!.getCell("B16").value).toBe("");
  });
});
