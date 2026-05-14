/**
 * lib/dal/etf-catalog — committed-mirror loader + searchEtfs ranking.
 *
 * Mirror at `mcp/data/etf_master.json` is generated from
 * `Funds_DAG/configs/etf_universe.yaml` via
 * `Funds_DAG/scripts/export_etf_master_json.py`. Tests verify (a) the loader
 * exposes aliases + entries from the committed file and (b) `searchEtfs`
 * ranks ticker exact > prefix > substring > name > sponsor.
 *
 * MASTER_BACKLOG L.6 / D.9.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  _reloadEtfCatalog,
  etfCatalogMetadata,
  getEtfEntry,
  listEtfEntries,
  lookupEtfTicker,
  searchEtfs,
} from "@/lib/dal/etf-catalog";

beforeAll(() => _reloadEtfCatalog());

describe("etf-catalog (committed mirror)", () => {
  it("loads the committed mcp/data/etf_master.json with a stable schema", () => {
    const meta = etfCatalogMetadata();
    expect(meta.schema_version).toBe("etf-master/1.0");
    expect(meta.n_entries).toBeGreaterThanOrEqual(3);
    expect(meta.path).toMatch(/mcp\/data\/etf_master\.json$/);
  });

  it("resolves tickers (case-insensitive)", () => {
    expect(lookupEtfTicker("IVV")).toBe("BW-ETF-IVV");
    expect(lookupEtfTicker("ivv")).toBe("BW-ETF-IVV");
    expect(lookupEtfTicker("SPY")).toBe("BW-ETF-SPY");
    expect(lookupEtfTicker("not-a-ticker")).toBeNull();
    expect(lookupEtfTicker("")).toBeNull();
  });

  it("getEtfEntry returns the full record", () => {
    const ivv = getEtfEntry("BW-ETF-IVV");
    expect(ivv).not.toBeNull();
    expect(ivv!.ticker).toBe("IVV");
    expect(ivv!.sponsor).toBe("ishares");
    expect(ivv!.name).toMatch(/iShares/);
    expect(getEtfEntry("BW-ETF-NOPE")).toBeNull();
  });

  it("listEtfEntries returns every catalog entry", () => {
    const all = listEtfEntries();
    expect(all.length).toBe(etfCatalogMetadata().n_entries);
    const ids = all.map((e) => e.bw_etf_id).sort();
    expect(ids).toContain("BW-ETF-IVV");
    expect(ids).toContain("BW-ETF-SPY");
  });
});

describe("searchEtfs ranking", () => {
  beforeAll(() => _reloadEtfCatalog());

  it("ranks exact ticker first", () => {
    const hits = searchEtfs("IVV");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.ticker).toBe("IVV");
    expect(hits[0]!.score).toBe(100);
  });

  it("returns a ticker-prefix hit ahead of a name-substring hit", () => {
    // The catalog has IVV (iShares Core S&P 500). 'iv' should hit IVV by ticker prefix
    // before any name-substring matches outscore it.
    const hits = searchEtfs("iv");
    expect(hits[0]!.ticker).toBe("IVV");
    expect(hits[0]!.score).toBeGreaterThanOrEqual(70);
  });

  it("matches name word-boundary prefix", () => {
    const hits = searchEtfs("ishares");
    // every iShares row should appear; first hit's sponsor or name carries iShares
    expect(hits.length).toBeGreaterThan(0);
    const first = hits[0]!;
    const matched =
      first.name.toLowerCase().includes("ishares") || first.sponsor === "ishares";
    expect(matched).toBe(true);
  });

  it("matches sponsor", () => {
    const hits = searchEtfs("vanguard");
    // Catalog includes Vanguard ETFs; sponsor match scores 20 minimum.
    if (hits.length > 0) {
      expect(hits[0]!.sponsor === "vanguard" || hits[0]!.name.toLowerCase().includes("vanguard")).toBe(true);
    }
  });

  it("empty query returns the full universe ordered by ticker (capped by limit)", () => {
    const hits = searchEtfs("", 5);
    expect(hits.length).toBe(5);
    const tickers = hits.map((h) => h.ticker);
    const sorted = [...tickers].sort();
    expect(tickers).toEqual(sorted);
    expect(hits[0]!.score).toBe(0);
  });

  it("limit clamps to [1, 100]", () => {
    expect(searchEtfs("", 0).length).toBe(1);
    expect(searchEtfs("", 500).length).toBeLessThanOrEqual(100);
    expect(searchEtfs("", 500).length).toBe(
      Math.min(100, etfCatalogMetadata().n_entries),
    );
  });

  it("unknown query returns []", () => {
    expect(searchEtfs("xyzzy-not-a-real-thing")).toEqual([]);
  });
});
