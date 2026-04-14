#!/usr/bin/env node
/**
 * Diagnose the exact shape zarrita.js decodes for the GCS ds_daily.zarr
 * `symbol` coordinate. One-off script — prints enough about the decoded
 * chunk that we can tell whether `readSymbolIndexMap`'s `d instanceof
 * UnicodeStringArray` check should be replaced with an Array.isArray
 * branch, a different class check, or something else entirely.
 *
 * Uses the same storage adapter pattern as lib/dal/zarr-reader.ts so the
 * results are faithful to what the API sees at runtime.
 *
 *   node scripts/diagnose-zarr-decode.mjs
 *
 * Needs GCP Application Default Credentials (or GCP_SERVICE_ACCOUNT_JSON)
 * with read access to gs://rm_api_data/eodhd/ds_daily.zarr.
 */

import { Storage } from "@google-cloud/storage";
import {
  get,
  open,
  root,
  tryWithConsolidated,
  UnicodeStringArray,
} from "zarrita";

const BUCKET = "rm_api_data";
const BASE_PATH = "eodhd";
const ZARR_NAME = "ds_daily.zarr";

// Mirror lib/dal/zarr-reader.ts:49-68 (GcsZarrStore) so we exercise the
// same zarrita read path the API uses.
class GcsZarrStore {
  constructor(bucket, zarrObjectPrefix) {
    this.bucket = bucket;
    this.zarrObjectPrefix = zarrObjectPrefix;
  }
  async get(key) {
    const rel = key.startsWith("/") ? key.slice(1) : key;
    const objectName = `${this.zarrObjectPrefix}/${rel}`.replace(/\/+/g, "/");
    try {
      const [buf] = await this.bucket.file(objectName).download();
      return new Uint8Array(buf);
    } catch (e) {
      if (e?.code === 404) return undefined;
      throw e;
    }
  }
}

function describe(label, d) {
  const lines = [`── ${label} ──`];
  lines.push(`  typeof           : ${typeof d}`);
  lines.push(`  d == null        : ${d == null}`);
  if (d == null) {
    console.log(lines.join("\n"));
    return;
  }
  lines.push(`  constructor.name : ${d?.constructor?.name ?? "(none)"}`);
  lines.push(`  Array.isArray    : ${Array.isArray(d)}`);
  lines.push(`  ArrayBuffer.isView: ${ArrayBuffer.isView(d)}`);
  lines.push(`  instanceof UnicodeStringArray: ${d instanceof UnicodeStringArray}`);
  lines.push(`  has .length      : ${"length" in d ? d.length : "(no)"}`);
  lines.push(`  has .get fn      : ${typeof d.get === "function"}`);

  // First few elements via both indexed access and .get() where possible.
  const first = [];
  const maxN = Math.min(5, d.length ?? 5);
  for (let i = 0; i < maxN; i++) {
    let v;
    try {
      v = typeof d.get === "function" ? d.get(i) : d[i];
    } catch (e) {
      v = `(throw: ${e?.message ?? e})`;
    }
    first.push({ i, typeof: typeof v, value: v });
  }
  lines.push(`  first ${maxN}         :`);
  for (const f of first) {
    const s = typeof f.value === "string"
      ? JSON.stringify(f.value)
      : String(f.value);
    lines.push(`    [${f.i}] (${f.typeof}) ${s}`);
  }
  console.log(lines.join("\n"));
}

async function main() {
  const storage = new Storage();
  const bucket = storage.bucket(BUCKET);
  const store = new GcsZarrStore(bucket, `${BASE_PATH}/${ZARR_NAME}`);

  console.log(`opening gs://${BUCKET}/${BASE_PATH}/${ZARR_NAME} …`);
  const consolidated = await tryWithConsolidated(store);
  const grp = await open.v2(root(consolidated), { kind: "group" });
  console.log("group opened ok");

  // Symbol coord — the prime suspect
  {
    const arr = await open.v2(grp.resolve("symbol"), { kind: "array" });
    console.log(`symbol.shape=${JSON.stringify(arr.shape)} dtype=${arr.dtype}`);
    const ch = await get(arr, null);
    describe("symbol chunk.data", ch?.data);
  }

  // Ticker coord — for completeness, if we end up wanting to key by ticker
  {
    try {
      const arr = await open.v2(grp.resolve("ticker"), { kind: "array" });
      console.log(`ticker.shape=${JSON.stringify(arr.shape)} dtype=${arr.dtype}`);
      const ch = await get(arr, null);
      describe("ticker chunk.data", ch?.data);
    } catch (e) {
      console.log(`ticker read failed: ${e?.message ?? e}`);
    }
  }

  // Teo — should be BigInt64Array per current code assumption
  {
    const arr = await open.v2(grp.resolve("teo"), { kind: "array" });
    console.log(`teo.shape=${JSON.stringify(arr.shape)} dtype=${arr.dtype}`);
    // Dump attrs so we can pick the right CF time decoder.
    console.log("teo.attrs =", JSON.stringify(arr.attrs ?? null));
    const ch = await get(arr, null);
    describe("teo chunk.data", ch?.data);
    // Print a few late values so we can sanity-check the day-offset decode.
    const d = ch?.data;
    if (d && d.length) {
      const last = [];
      for (let i = Math.max(0, d.length - 3); i < d.length; i++) {
        last.push(`[${i}] ${d[i]}`);
      }
      console.log(`  last 3           : ${last.join(", ")}`);
    }
  }
}

// -----------------------------------------------------------------------
// Integration check: exercises the same decode paths the fixed zarr-reader
// now uses, against the real GCS stores, and verifies NVDA actually comes
// back with real rows. This validates bugs 1, 2, 3 are all fixed before
// we bother deploying.
// -----------------------------------------------------------------------

const NVDA_SYMBOL = "BW-BBG000BBJQV0";
const START_DATE = "2025-04-14"; // match what /api/ticker-returns?years=1 would pass

function readSymbolMap(d) {
  const m = new Map();
  if (d && typeof d.get === "function" && !Array.isArray(d)) {
    for (let i = 0; i < d.length; i++) m.set(String(d.get(i)).trim(), i);
  } else if (Array.isArray(d)) {
    for (let i = 0; i < d.length; i++) m.set(String(d[i]).trim(), i);
  }
  return m;
}

function decodeTeo(data, unitsAttr) {
  const units = typeof unitsAttr === "string" ? unitsAttr : "";
  const cf = units.match(/^days since (\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}:\d{2})?/);
  if (!cf) return null;
  const baseMs = Date.parse(`${cf[1]}T00:00:00Z`);
  const MS_PER_DAY = 86_400_000;
  return Array.from(data, (v) => new Date(baseMs + Number(v) * MS_PER_DAY).toISOString().slice(0, 10));
}

function lowerBound(sorted, x) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function upperBoundInclusive(sorted, x) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

async function openStore(bucket, basePath, zarrName) {
  const store = new GcsZarrStore(bucket, `${basePath}/${zarrName}`);
  const consolidated = await tryWithConsolidated(store);
  return await open.v2(root(consolidated), { kind: "group" });
}

async function integrationCheck() {
  console.log("\n=================== INTEGRATION CHECK ===================");
  const storage = new Storage();
  const bucket = storage.bucket(BUCKET);

  const daily = await openStore(bucket, BASE_PATH, "ds_daily.zarr");
  const hedge = await openStore(bucket, BASE_PATH, "ds_erm3_hedge_weights_SPY_uni_mc_3000.zarr");
  const returns = await openStore(bucket, BASE_PATH, "ds_erm3_returns_SPY_uni_mc_3000.zarr");

  // Symbol maps — per store
  const dSymArr = (await open.v2(daily.resolve("symbol"), { kind: "array" }));
  const hSymArr = (await open.v2(hedge.resolve("symbol"), { kind: "array" }));
  const rSymArr = (await open.v2(returns.resolve("symbol"), { kind: "array" }));
  const dSymMap = readSymbolMap((await get(dSymArr, null))?.data);
  const hSymMap = readSymbolMap((await get(hSymArr, null))?.data);
  const rSymMap = readSymbolMap((await get(rSymArr, null))?.data);
  const dIdx = dSymMap.get(NVDA_SYMBOL);
  const hIdx = hSymMap.get(NVDA_SYMBOL);
  const rIdx = rSymMap.get(NVDA_SYMBOL);
  console.log(`NVDA idx: daily=${dIdx}, hedge=${hIdx}, returns=${rIdx}`);
  console.log(`(idx independence confirmed: daily!=hedge → ${dIdx !== hIdx})`);

  // Teo per store
  const dTeoArr = (await open.v2(daily.resolve("teo"), { kind: "array" }));
  const hTeoArr = (await open.v2(hedge.resolve("teo"), { kind: "array" }));
  const rTeoArr = (await open.v2(returns.resolve("teo"), { kind: "array" }));
  const dTeo = decodeTeo((await get(dTeoArr, null)).data, dTeoArr.attrs?.units);
  const hTeo = decodeTeo((await get(hTeoArr, null)).data, hTeoArr.attrs?.units);
  const rTeo = decodeTeo((await get(rTeoArr, null)).data, rTeoArr.attrs?.units);
  console.log(`teo decoded: daily[${dTeo?.length}] ${dTeo?.[0]}..${dTeo?.[dTeo.length - 1]}`);
  console.log(`             hedge[${hTeo?.length}] ${hTeo?.[0]}..${hTeo?.[hTeo.length - 1]}`);
  console.log(`             returns[${rTeo?.length}] ${rTeo?.[0]}..${rTeo?.[rTeo.length - 1]}`);

  // Common range
  let effStart = START_DATE;
  let effEnd = "9999-12-31";
  for (const t of [dTeo, hTeo, rTeo]) {
    if (!t?.length) continue;
    if (t[0] > effStart) effStart = t[0];
    if (t[t.length - 1] < effEnd) effEnd = t[t.length - 1];
  }
  console.log(`common range: ${effStart} .. ${effEnd}`);

  // Per-store bounds
  const [dt0, dt1] = [lowerBound(dTeo, effStart), upperBoundInclusive(dTeo, effEnd)];
  const [ht0, ht1] = [lowerBound(hTeo, effStart), upperBoundInclusive(hTeo, effEnd)];
  const [rt0, rt1] = [lowerBound(rTeo, effStart), upperBoundInclusive(rTeo, effEnd)];
  console.log(`bounds: daily=[${dt0},${dt1}) hedge=[${ht0},${ht1}) returns=[${rt0},${rt1})`);

  // Read a float series from each store — prove the pipeline actually yields data
  const { slice } = await import("zarrita");

  // Daily `return` (→ returns_gross)
  const dReturnArr = await open.v2(daily.resolve("return"), { kind: "array" });
  const dReturn = await get(dReturnArr, [slice(dt0, dt1), dIdx]);
  const drVals = Array.from(dReturn.data);
  console.log(`daily return: shape=${dReturn.shape} first5=${drVals.slice(0, 5).map((x) => x?.toFixed?.(6) ?? x)}`);

  // Hedge L3_market_HR
  const hHrArr = await open.v2(hedge.resolve("L3_market_HR"), { kind: "array" });
  const hHr = await get(hHrArr, [slice(ht0, ht1), hIdx]);
  const hhVals = Array.from(hHr.data);
  console.log(`hedge L3_market_HR: shape=${hHr.shape} first5=${hhVals.slice(0, 5).map((x) => x?.toFixed?.(6) ?? x)}`);

  // Returns combined_factor_return at level=subsector
  const levelArr = await open.v2(returns.resolve("level"), { kind: "array" });
  const levelMap = readSymbolMap((await get(levelArr, null)).data);
  const subIdx = levelMap.get("subsector") ?? levelMap.get("Subsector") ?? 2;
  const rCfrArr = await open.v2(returns.resolve("combined_factor_return"), { kind: "array" });
  const rCfr = await get(rCfrArr, [slice(rt0, rt1), rIdx, subIdx]);
  const rcVals = Array.from(rCfr.data);
  console.log(`returns combined_factor_return L3: shape=${rCfr.shape} first5=${rcVals.slice(0, 5).map((x) => x?.toFixed?.(6) ?? x)}`);

  // Count non-null and check length alignment
  const nonNull = (arr) => arr.filter((x) => x != null && Number.isFinite(Number(x))).length;
  console.log(`\nnon-null counts: daily=${nonNull(drVals)}/${drVals.length}  hedge=${nonNull(hhVals)}/${hhVals.length}  returns=${nonNull(rcVals)}/${rcVals.length}`);

  const ok = nonNull(drVals) > 200 && nonNull(hhVals) > 200 && nonNull(rcVals) > 200;
  console.log(`\n${ok ? "PASS" : "FAIL"} — NVDA ${ok ? "returns real data from all three stores" : "still empty in at least one store"}`);
  return ok;
}

main()
  .then(() => integrationCheck())
  .then((ok) => {
    process.exit(ok ? 0 : 2);
  })
  .catch((e) => {
    console.error("FATAL:", e);
    process.exit(1);
  });
