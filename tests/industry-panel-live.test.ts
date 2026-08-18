import { describe, expect, it } from "vitest";

import { readIndustryPanelSnapshot } from "@/lib/dal/zarr-reader";

/**
 * Live GCS acceptance for the fact-keyed industry panel (ERM3 #158).
 *
 *   INDUSTRY_PANEL_LIVE_TEST=1 npx vitest run tests/industry-panel-live.test.ts
 *
 * Multi-fact cells are historical. At the latest teo every industry has
 * n_facts == 1. The fixture below is the last L3 multi-fact day:
 *   teo=2021-06-22  industry=4850  facts=['IAI','IYG']
 */
const LIVE = !!process.env.INDUSTRY_PANEL_LIVE_TEST;

const FIXTURE_TEO = "2021-06-22";
const FIXTURE_INDUSTRY = 4850;
const FIXTURE_FACTS = ["IAI", "IYG"] as const;

describe.skipIf(!LIVE)("live GCS industry panel — fact-keyed vintage", () => {
  it(
    "by=fact is 200-shaped (panel_key=fact, fact column present)",
    { timeout: 180_000 },
    async () => {
      const snap = await readIndustryPanelSnapshot({
        teo: FIXTURE_TEO,
        level: "subsector",
        by: "fact",
      });
      expect(snap.teo).toBe(FIXTURE_TEO);
      expect(snap.panel_key).toBe("fact");
      expect(snap.by).toBe("fact");
      expect(snap.rows.length).toBeGreaterThan(0);
      expect(snap.rows.every((r) => typeof r.fact === "string" && r.fact.length > 0)).toBe(
        true,
      );
    },
  );

  it(
    "teo=2021-06-22 industry=4850 has n_facts=2 on IAI and IYG",
    { timeout: 180_000 },
    async () => {
      const byFact = await readIndustryPanelSnapshot({
        teo: FIXTURE_TEO,
        level: "subsector",
        by: "fact",
      });
      const facts = byFact.rows
        .filter((r) => r.industry_code === FIXTURE_INDUSTRY)
        .map((r) => r.fact)
        .sort();
      expect(facts).toEqual([...FIXTURE_FACTS]);

      const iai = byFact.rows.find(
        (r) => r.industry_code === FIXTURE_INDUSTRY && r.fact === "IAI",
      );
      const iyg = byFact.rows.find(
        (r) => r.industry_code === FIXTURE_INDUSTRY && r.fact === "IYG",
      );
      expect(iai?.beta_mean).toBeCloseTo(0.376, 3);
      expect(iyg?.beta_mean).toBeCloseTo(0.7522, 3);
      expect(iai?.n_companies).toBe(5);
      expect(iyg?.n_companies).toBe(17);

      const byLevel = await readIndustryPanelSnapshot({
        teo: FIXTURE_TEO,
        level: "subsector",
        by: "level",
      });
      expect(byLevel.panel_key).toBe("fact");
      const row = byLevel.rows.find((r) => r.industry_code === FIXTURE_INDUSTRY);
      expect(row?.n_facts).toBe(2);
      expect(row?.n_companies).toBe(22);
      expect(row?.level).toBe("subsector");
      expect(row?.fact).toBeUndefined();
    },
  );

  it(
    "latest teo is single-fact on every returned level-row",
    { timeout: 180_000 },
    async () => {
      const snap = await readIndustryPanelSnapshot({ by: "level" });
      expect(snap.panel_key).toBe("fact");
      expect(snap.teo).toBeTruthy();
      expect(snap.rows.length).toBeGreaterThan(0);
      expect(snap.rows.every((r) => r.n_facts === 1)).toBe(true);
    },
  );
});
