/**
 * RMAPI-30 — the cohort-store link-beta reader, exercised on an in-memory zarr v2
 * group laid out like the published `ds_erm3_cohorts_SPY_uni_mc_3000.zarr`:
 *   teo            (teo,)                    <i8   "days since 2000-01-03"
 *   ticker         (cohort,)                 |O    vlen-utf8
 *   cohort_level   (cohort,)                 |i1
 *   link_policy    (link_policy,)            |O    vlen-utf8
 *   linked_beta / linked_beta_mkt / linked_beta_r2   (teo, cohort)  <f4
 *   linked_beta_policy                       (teo, cohort, link_policy)  <f4
 *
 * Every number below is a real cell copied from the cohort store in the
 * 2026-11-05 release, for cohorts SPY, XLK, XLE and SOXX at teo indexes -22
 * (2026-09-24, day 9761) and -1 (2026-10-23, day 9790). In the real store the
 * "attribution" and "hedge" policy slots hold identical values ("hedge" is an
 * alias today), so the policy test checks that the 3-D cell is read correctly;
 * the name lookup itself is tested on `hedgeLinkPolicyIndex`.
 */
import { describe, expect, it } from "vitest";
import { open, root } from "zarrita";
import type { Group } from "zarrita";
import type { AbsolutePath, Readable } from "@zarrita/storage";

import {
  hedgeLinkPolicyIndex,
  isServedMarketFactorEtf,
  linkTeoIndexOnOrBefore,
  readLatestLinkBetas,
  readLinkBetasFromGroup,
} from "@/lib/dal/zarr-reader";

const TEO_DAYS = [9761, 9790];
const TICKERS = ["SPY", "XLK", "XLE", "SOXX"];
const LEVELS = [1, 2, 2, 3];
const POLICIES = ["attribution", "hedge"];
// [teo][cohort]
const LINKED_BETA = [
  [NaN, 1.7455346584320068, -0.2935803532600403, 2.3152873516082764],
  [NaN, 1.7590864896774292, -0.39969542622566223, 2.2708287239074707],
];
const LINKED_BETA_MKT = [
  [NaN, 1.7455346584320068, -0.2935803532600403, 2.6041665077209473],
  [NaN, 1.7590864896774292, -0.39969542622566223, 2.6149649620056152],
];
const LINKED_BETA_R2 = [
  [NaN, 0.7257300615310669, 0.02993941307067871, 0.5093010067939758],
  [NaN, 0.7183336615562439, 0.05323369801044464, 0.5027673840522766],
];

const enc = new TextEncoder();
const json = (o: unknown) => enc.encode(JSON.stringify(o));

function vlenUtf8(values: string[]): Uint8Array {
  const parts = values.map((v) => enc.encode(v));
  const total = 4 + parts.reduce((s, p) => s + 4 + p.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, values.length, true);
  let off = 4;
  for (const p of parts) {
    dv.setUint32(off, p.length, true);
    out.set(p, off + 4);
    off += 4 + p.length;
  }
  return out;
}

function zarray(shape: number[], dtype: string, extra: Record<string, unknown> = {}) {
  return json({
    zarr_format: 2,
    shape,
    chunks: shape,
    dtype,
    compressor: null,
    fill_value: dtype.endsWith("f4") ? "NaN" : null,
    order: "C",
    filters: null,
    ...extra,
  });
}

function buildStore(opts: { withPolicyAxis: boolean }): Map<string, Uint8Array> {
  const s = new Map<string, Uint8Array>();
  s.set("/.zgroup", json({ zarr_format: 2 }));
  s.set("/.zattrs", json({}));

  s.set("/teo/.zarray", zarray([2], "<i8"));
  s.set("/teo/.zattrs", json({ _ARRAY_DIMENSIONS: ["teo"], units: "days since 2000-01-03 00:00:00", calendar: "proleptic_gregorian" }));
  s.set("/teo/0", new Uint8Array(new BigInt64Array(TEO_DAYS.map(BigInt)).buffer));

  const objArr = { filters: [{ id: "vlen-utf8" }] };
  s.set("/ticker/.zarray", zarray([4], "|O", objArr));
  s.set("/ticker/.zattrs", json({ _ARRAY_DIMENSIONS: ["cohort"] }));
  s.set("/ticker/0", vlenUtf8(TICKERS));

  s.set("/cohort_level/.zarray", zarray([4], "|i1"));
  s.set("/cohort_level/.zattrs", json({ _ARRAY_DIMENSIONS: ["cohort"] }));
  s.set("/cohort_level/0", new Uint8Array(new Int8Array(LEVELS).buffer));

  const plane = (name: string, rows: number[][]) => {
    s.set(`/${name}/.zarray`, zarray([2, 4], "<f4"));
    s.set(`/${name}/.zattrs`, json({ _ARRAY_DIMENSIONS: ["teo", "cohort"] }));
    s.set(`/${name}/0.0`, new Uint8Array(new Float32Array(rows.flat()).buffer));
  };
  plane("linked_beta", LINKED_BETA);
  plane("linked_beta_mkt", LINKED_BETA_MKT);
  plane("linked_beta_r2", LINKED_BETA_R2);

  if (opts.withPolicyAxis) {
    s.set("/link_policy/.zarray", zarray([2], "|O", objArr));
    s.set("/link_policy/.zattrs", json({ _ARRAY_DIMENSIONS: ["link_policy"] }));
    s.set("/link_policy/0", vlenUtf8(POLICIES));
    // Both policy slots carry the real (identical) linked_beta value.
    const cube = LINKED_BETA.flatMap((row) => row.flatMap((v) => [v, v]));
    s.set("/linked_beta_policy/.zarray", zarray([2, 4, 2], "<f4"));
    s.set("/linked_beta_policy/.zattrs", json({ _ARRAY_DIMENSIONS: ["teo", "cohort", "link_policy"] }));
    s.set("/linked_beta_policy/0.0.0", new Uint8Array(new Float32Array(cube).buffer));
  }
  return s;
}

async function openStore(s: Map<string, Uint8Array>): Promise<Group<Readable>> {
  const store = { get: async (key: AbsolutePath) => s.get(key) };
  return (await open.v2(root(store as unknown as Readable), { kind: "group" })) as Group<Readable>;
}

describe("readLinkBetasFromGroup — in-memory cohort store (real cells)", () => {
  it("decodes the latest teo and reads the latest cell, not an earlier one", async () => {
    const grp = await openStore(buildStore({ withPolicyAxis: true }));
    const lb = (await readLinkBetasFromGroup(grp, "XLK", "SOXX"))!;
    expect(lb.teo).toBe("2026-10-23");
    expect(lb.lambda_s_to_m).toBeCloseTo(1.7590864896774292, 6); // not 1.74553 (2026-09-23)
    expect(lb.lambda_s_to_m_r2).toBeCloseTo(0.7183336615562439, 6);
    expect(lb.lambda_u_to_m).toBeCloseTo(2.6149649620056152, 6);
    expect(lb.lambda_u_to_s).toBeCloseTo(2.2708287239074707, 6);
  });

  it("reads the policy cube cell when the store carries a policy axis", async () => {
    const grp = await openStore(buildStore({ withPolicyAxis: true }));
    const lb = (await readLinkBetasFromGroup(grp, "XLE", null))!;
    expect(lb.lambda_s_to_m).toBeCloseTo(-0.39969542622566223, 6);
    expect(lb.lambda_s_to_m_r2).toBeCloseTo(0.05323369801044464, 6); // XLE: weakly identified
  });

  it("falls back to linked_beta when the store predates the policy axis", async () => {
    const grp = await openStore(buildStore({ withPolicyAxis: false }));
    const lb = (await readLinkBetasFromGroup(grp, "XLK", "SOXX"))!;
    expect(lb.lambda_s_to_m).toBeCloseTo(1.7590864896774292, 6);
    expect(lb.lambda_u_to_s).toBeCloseTo(2.2708287239074707, 6);
  });

  it("an unknown ticker or the market root gives null lambdas, not 0", async () => {
    const grp = await openStore(buildStore({ withPolicyAxis: true }));
    const lb = (await readLinkBetasFromGroup(grp, "ZZZZ", "SPY"))!;
    expect(lb.lambda_s_to_m).toBeNull();
    expect(lb.lambda_u_to_m).toBeNull(); // SPY is level 1; the caller applies λ=1
    expect(lb.lambda_u_to_s).toBeNull();
  });

  it("with as_of, reads the latest teo on or before it — never a later one", async () => {
    const grp = await openStore(buildStore({ withPolicyAxis: true }));
    const between = (await readLinkBetasFromGroup(grp, "XLK", "SOXX", "2026-10-01"))!;
    expect(between.teo).toBe("2026-09-24");
    expect(between.lambda_s_to_m).toBeCloseTo(1.7455346584320068, 6);
    expect(between.lambda_u_to_m).toBeCloseTo(2.6041665077209473, 6);
    const onDate = (await readLinkBetasFromGroup(grp, "XLK", null, "2026-10-23"))!;
    expect(onDate.teo).toBe("2026-10-23");
    expect(onDate.lambda_s_to_m).toBeCloseTo(1.7590864896774292, 6);
  });

  it("with as_of before every teo, returns null (no link betas from the future)", async () => {
    const grp = await openStore(buildStore({ withPolicyAxis: true }));
    await expect(readLinkBetasFromGroup(grp, "XLK", "SOXX", "2026-09-01")).resolves.toBeNull();
  });

  it("ticker matching is case-insensitive", async () => {
    const grp = await openStore(buildStore({ withPolicyAxis: true }));
    const lb = (await readLinkBetasFromGroup(grp, "xlk", null))!;
    expect(lb.lambda_s_to_m).toBeCloseTo(1.7590864896774292, 6);
  });
});

describe("linkTeoIndexOnOrBefore", () => {
  const teos = ["2026-09-24", "2026-10-23"];
  it("picks the latest date on or before as_of", () => {
    expect(linkTeoIndexOnOrBefore(teos, "2026-10-23")).toBe(1);
    expect(linkTeoIndexOnOrBefore(teos, "2026-10-22")).toBe(0);
    expect(linkTeoIndexOnOrBefore(teos, "2026-11-06")).toBe(1);
    expect(linkTeoIndexOnOrBefore(teos, "2026-09-01")).toBe(-1);
    expect(linkTeoIndexOnOrBefore(teos, null)).toBe(1);
  });
});

describe("policy lookup and market-factor guard", () => {
  it("finds the hedge policy by name, whatever its position", () => {
    expect(hedgeLinkPolicyIndex(["attribution", "hedge"])).toBe(1);
    expect(hedgeLinkPolicyIndex(["hedge", "attribution"])).toBe(0);
    expect(hedgeLinkPolicyIndex(["attribution"])).toBe(-1);
    expect(hedgeLinkPolicyIndex(null)).toBe(-1);
  });

  it("serves only the market root of the configured factor set", () => {
    expect(isServedMarketFactorEtf("SPY", "SPY_uni_mc_3000")).toBe(true);
    expect(isServedMarketFactorEtf("spy", "SPY_uni_mc_3000")).toBe(true);
    expect(isServedMarketFactorEtf("QQQ", "SPY_uni_mc_3000")).toBe(false);
    expect(isServedMarketFactorEtf("SP", "SPY_uni_mc_3000")).toBe(false);
  });

  it("readLatestLinkBetas returns null for a mismatched market factor without opening a store", async () => {
    await expect(readLatestLinkBetas("XLK", "SOXX", "QQQ")).resolves.toBeNull();
  });
});
