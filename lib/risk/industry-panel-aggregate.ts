/**
 * Collapse (industry × fact) peer-β cells onto (industry × cascade level).
 *
 * `ds_erm3_industry_*` is keyed by `fact` (ERM3 #158). Default
 * `GET /industry-panel` stays one row per (industry, level); this
 * module is the documented collapse. `?by=fact` skips it and returns the
 * per-fact cells.
 *
 * Mean is n_companies-weighted. Variance uses the law of total variance so a
 * single-fact group is unchanged and a multi-fact group is a mixture, not an
 * average of τ².
 */

export const INDUSTRY_PANEL_LEVELS = ["market", "sector", "subsector"] as const;
export type IndustryPanelLevel = (typeof INDUSTRY_PANEL_LEVELS)[number];

export type IndustryPanelBy = "level" | "fact";
export type IndustryPanelKey = "level" | "fact";

/** ERM3 `fact_level` coord: 1=market, 2=sector, 3=subsector. 4=style is retired. */
export const FACT_LEVEL_TO_NAME: Record<number, IndustryPanelLevel> = {
  1: "market",
  2: "sector",
  3: "subsector",
};

export interface IndustryPanelFactCell {
  industry_code: number;
  level: IndustryPanelLevel;
  fact: string;
  beta_mean: number;
  beta_variance: number | null;
  n_companies: number;
  total_log_mcap_weight: number | null;
}

export interface IndustryPanelRow {
  industry_code: number;
  level: IndustryPanelLevel;
  beta_mean: number | null;
  beta_variance: number | null;
  n_companies: number | null;
  total_log_mcap_weight: number | null;
  /** Present on `by=level` rows after a fact-keyed store. Always 1 on a level-keyed vintage. */
  n_facts?: number;
  /** Present on `by=fact` rows. ETF ticker of the cascade fact. */
  fact?: string;
}

export function factLevelToName(code: number): IndustryPanelLevel | null {
  return FACT_LEVEL_TO_NAME[code] ?? null;
}

/**
 * Collapse per-fact cells that have already cleared `min_peers` onto one row
 * per (industry_code, level). Empty input → empty output.
 */
export function aggregateFactsToLevel(
  cells: readonly IndustryPanelFactCell[],
): IndustryPanelRow[] {
  const groups = new Map<string, IndustryPanelFactCell[]>();
  for (const cell of cells) {
    const key = `${cell.industry_code}\t${cell.level}`;
    const list = groups.get(key);
    if (list) list.push(cell);
    else groups.set(key, [cell]);
  }

  const rows: IndustryPanelRow[] = [];
  for (const group of groups.values()) {
    const first = group[0]!;
    if (group.length === 1) {
      rows.push({
        industry_code: first.industry_code,
        level: first.level,
        beta_mean: first.beta_mean,
        beta_variance: first.beta_variance,
        n_companies: first.n_companies,
        total_log_mcap_weight: first.total_log_mcap_weight,
        n_facts: 1,
      });
      continue;
    }

    let nSum = 0;
    let meanAcc = 0;
    let secondMomentAcc = 0;
    let varMissing = false;
    let weightSum = 0;
    let weightAny = false;
    for (const cell of group) {
      nSum += cell.n_companies;
      meanAcc += cell.beta_mean * cell.n_companies;
      if (cell.beta_variance == null || !Number.isFinite(cell.beta_variance)) {
        varMissing = true;
      } else {
        secondMomentAcc +=
          (cell.beta_variance + cell.beta_mean * cell.beta_mean) * cell.n_companies;
      }
      if (cell.total_log_mcap_weight != null && Number.isFinite(cell.total_log_mcap_weight)) {
        weightSum += cell.total_log_mcap_weight;
        weightAny = true;
      }
    }
    if (nSum <= 0) continue;
    const mu = meanAcc / nSum;
    const variance = varMissing ? null : secondMomentAcc / nSum - mu * mu;
    rows.push({
      industry_code: first.industry_code,
      level: first.level,
      beta_mean: mu,
      beta_variance: variance != null && Number.isFinite(variance) ? Math.max(0, variance) : null,
      n_companies: nSum,
      total_log_mcap_weight: weightAny ? weightSum : null,
      n_facts: group.length,
    });
  }

  rows.sort((a, b) => {
    const lc = a.level.localeCompare(b.level);
    if (lc !== 0) return lc;
    return a.industry_code - b.industry_code;
  });
  return rows;
}

export function factCellsToFactRows(
  cells: readonly IndustryPanelFactCell[],
): IndustryPanelRow[] {
  const rows = cells.map((cell) => ({
    industry_code: cell.industry_code,
    level: cell.level,
    beta_mean: cell.beta_mean,
    beta_variance: cell.beta_variance,
    n_companies: cell.n_companies,
    total_log_mcap_weight: cell.total_log_mcap_weight,
    fact: cell.fact,
  }));
  rows.sort((a, b) => {
    const lc = a.level.localeCompare(b.level);
    if (lc !== 0) return lc;
    const ic = a.industry_code - b.industry_code;
    if (ic !== 0) return ic;
    return (a.fact ?? "").localeCompare(b.fact ?? "");
  });
  return rows;
}

export class IndustryPanelFactAxisUnavailable extends Error {
  readonly code = "industry_panel_fact_axis_unavailable" as const;

  constructor() {
    super(
      "by=fact requires the fact-keyed industry panel; this vintage is still keyed by cascade level",
    );
    this.name = "IndustryPanelFactAxisUnavailable";
  }
}
