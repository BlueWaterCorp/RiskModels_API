import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";

import { formatResponse } from "@/lib/api/format-response";

const parquet = require("parquetjs-lite"); // eslint-disable-line

async function readParquet(buf: Buffer): Promise<Record<string, unknown>[]> {
  const tmp = path.join(os.tmpdir(), `fr-test-${randomUUID()}.parquet`);
  fs.writeFileSync(tmp, buf);
  try {
    const reader = await parquet.ParquetReader.openFile(tmp);
    const cursor = reader.getCursor();
    const out: Record<string, unknown>[] = [];
    let rec;
    while ((rec = await cursor.next())) out.push(rec);
    await reader.close();
    return out;
  } finally {
    fs.unlinkSync(tmp);
  }
}

describe("formatResponse parquet schema inference", () => {
  it("types a column from its first non-null value, not the first row (batch L* L1-then-L2)", async () => {
    const rows = [
      { ticker: "AAPL", date: "2026-09-10", lstar: "L1", market_hr: -0.55, sector_hr: null },
      { ticker: "NVDA", date: "2026-09-10", lstar: "L2", market_hr: -0.24, sector_hr: -0.96 },
    ];
    const res = await formatResponse({ rows, format: "parquet", filename: "t.parquet" });
    expect(res.status).toBe(200);
    const back = await readParquet(Buffer.from(await res.arrayBuffer()));
    expect(back).toHaveLength(2);
    expect(back[1]!.sector_hr).toBeCloseTo(-0.96);
    expect(back[0]!.sector_hr ?? null).toBeNull();
  });

  it("widens an integer-looking first value to DOUBLE when later values are fractional", async () => {
    const rows = [{ x: 0 }, { x: 1.5 }];
    const res = await formatResponse({ rows, format: "parquet", filename: "t.parquet" });
    const back = await readParquet(Buffer.from(await res.arrayBuffer()));
    expect(back.map((r) => r.x)).toEqual([0, 1.5]);
  });
});
