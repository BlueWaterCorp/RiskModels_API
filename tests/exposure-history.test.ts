import { describe, expect, it } from "vitest";
import { RAW_RESTRICTED_KEYS, RAW_SERIES_KEYS } from "@/lib/data-license";
import { EXPOSURE_PANEL_VARS, type ExposurePanelSlice, type ExposurePanelVar } from "@/lib/dal/zarr-reader";
import { COV_COLUMNS, NAME_COLUMNS, buildHistoryTables, toParquet } from "@/lib/portfolio/exposure-history";
import { calculateEstimatedCost } from "@/lib/agent/capabilities";

const TEOS = ["2024-01-31", "2024-02-29", "2024-03-28"];
const ETFS = ["SPY", "XLK", "SMH", "XLF"];

function cols(over: Partial<Record<ExposurePanelVar, Array<number | null>>>) {
  const base = Object.fromEntries(EXPOSURE_PANEL_VARS.map((v) => [v, [null, null, null]])) as Record<
    ExposurePanelVar,
    Array<number | null>
  >;
  return { ...base, ...over };
}

function slice(): ExposurePanelSlice {
  const k = ETFS.length;
  const cov = TEOS.map((_, t) => {
    const m = new Float32Array(k * k);
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) m[i * k + j] = (i + 1) * (j + 1) * 1e-5 * (t + 1);
    m[3 * k + 3] = NaN; // XLF variance unavailable
    return m;
  });
  return {
    teos: TEOS,
    etfs: ETFS,
    cov,
    attrs: { built_utc: "2026-10-08T00:00:00Z" },
    bySymbol: new Map([
      // NVDA: no data in January (pre-listing analogue), full afterwards.
      ["S-NVDA", cols({ l1_mkt_hr: [null, -1.8, -1.7], stock_var: [null, 9e-4, 8e-4], lstar_level: [null, 3, 2] })],
      ["S-EMPTY", cols({})],
    ]),
  };
}

describe("buildHistoryTables", () => {
  const names = [
    { symbol: "S-NVDA", tickers: ["NVDA"], sector_etf: "XLK", subsector_etf: "SMH" },
    { symbol: "S-EMPTY", tickers: ["EMPTY"], sector_etf: "XLF", subsector_etf: null },
  ];
  const out = buildHistoryTables(slice(), names, []);

  it("emits a row only for months with model data, and L1 beta = -l1_mkt_hr", () => {
    expect(out.names.map((r) => r.teo)).toEqual(["2024-02-29", "2024-03-28"]);
    expect(out.names[0]).toMatchObject({ ticker: "NVDA", symbol: "S-NVDA", sector_etf: "XLK", l1_mkt_beta: 1.8, lstar_level: 3 });
    expect(out.delivered).toEqual(["S-NVDA"]);
    expect(out.noData).toEqual(["S-EMPTY"]);
  });

  it("limits the covariance to SPY and delivered names' ETFs, upper triangle, finite only", () => {
    expect(out.covEtfs).toEqual(["SPY", "XLK", "SMH"]); // XLF belonged only to the name with no data
    expect(out.cov).toHaveLength(TEOS.length * 6); // 3 ETFs → 6 pairs with i <= j
    expect(out.cov.every((r) => typeof r.cov === "number" && Number.isFinite(r.cov))).toBe(true);
    const spyXlk = out.cov.find((r) => r.teo === "2024-01-31" && r.etf_i === "SPY" && r.etf_j === "XLK")!;
    expect(spyXlk.cov).toBeCloseTo(2e-5, 9);
  });

  it("adds directly held ETFs to the covariance universe and drops non-finite cells", () => {
    const withXlf = buildHistoryTables(slice(), names, ["XLF"]);
    expect(withXlf.covEtfs).toEqual(["SPY", "XLK", "SMH", "XLF"]);
    expect(withXlf.cov.some((r) => r.etf_i === "XLF" && r.etf_j === "XLF")).toBe(false); // NaN variance
  });
});

describe("licence boundary", () => {
  it("never delivers a raw price, market cap or return series column", () => {
    const raw = new Set([...RAW_SERIES_KEYS, ...RAW_RESTRICTED_KEYS, "returns_gross", "return", "close", "price"]);
    for (const c of [...NAME_COLUMNS, ...COV_COLUMNS]) expect(raw.has(c), c).toBe(false);
  });
});

describe("parquet output", () => {
  it("writes the fixed columns and reads back", async () => {
    const parquet = require("parquetjs-lite"); // eslint-disable-line
    const fs = await import("fs");
    const os = await import("os");
    const path = await import("path");
    const buf = await toParquet(buildHistoryTables(slice(), [{ symbol: "S-NVDA", tickers: ["NVDA"], sector_etf: "XLK", subsector_etf: "SMH" }], []).names, NAME_COLUMNS);
    const p = path.join(os.tmpdir(), `eh-${Date.now()}.parquet`);
    fs.writeFileSync(p, buf);
    const reader = await parquet.ParquetReader.openFile(p);
    const schemaCols = reader.getSchema().fieldList.map((f: { name: string }) => f.name);
    const cursor = reader.getCursor();
    const first = await cursor.next();
    await reader.close();
    fs.unlinkSync(p);
    // Readers omit null fields from records, so compare the file schema.
    expect(schemaCols.sort()).toEqual([...NAME_COLUMNS].sort());
    expect(first.ticker).toBe("NVDA");
    expect(first.l1_mkt_beta).toBeCloseTo(1.8, 5);
  });
});

describe("history pricing", () => {
  const price = (n: number) => calculateEstimatedCost("portfolio-exposure-history", { itemCount: n });
  it("is $1.25 up to 25 names and $5.00 above", () => {
    expect(price(1)).toBe(1.25);
    expect(price(25)).toBe(1.25);
    expect(price(26)).toBe(5.0);
    expect(price(1000)).toBe(5.0);
  });
});
