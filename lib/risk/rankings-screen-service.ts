/**
 * Rankings screen service — full cross-section filter from ds_rankings zarr.
 */

import {
  fetchRankingsScreen,
  type TopRankingRow,
} from "@/lib/dal/risk-engine-v3";
import { getZarrFactorSetId } from "@/lib/zarr-config";

export type { TopRankingRow };

export interface RankingsScreenResult {
  teo: string;
  metric: string;
  cohort: string;
  window: string;
  limit: number;
  min_percentile?: number;
  decile?: number;
  sector_filter?: string;
  universe_size: number;
  matched_count: number;
  rankings: TopRankingRow[];
  universe: string;
  data_source: string;
}

export class RankingsScreenService {
  async screen(params: {
    metric: string;
    cohort: string;
    window: string;
    as_of?: string;
    min_percentile?: number;
    decile?: number;
    sector_filter?: string;
    limit?: number;
  }): Promise<RankingsScreenResult | null> {
    const snapshot = await fetchRankingsScreen(params);
    if (!snapshot.teo) return null;

    return {
      teo: snapshot.teo,
      metric: params.metric,
      cohort: params.cohort,
      window: params.window,
      limit: params.limit ?? 100,
      ...(params.min_percentile != null
        ? { min_percentile: params.min_percentile }
        : {}),
      ...(params.decile != null ? { decile: params.decile } : {}),
      ...(params.sector_filter
        ? { sector_filter: params.sector_filter.trim().toUpperCase() }
        : {}),
      universe_size: snapshot.universe_size,
      matched_count: snapshot.matched_count,
      rankings: snapshot.rows,
      universe: getZarrFactorSetId(),
      data_source: "zarr",
    };
  }
}

let _service: RankingsScreenService | null = null;

export function getRankingsScreenService(): RankingsScreenService {
  if (!_service) _service = new RankingsScreenService();
  return _service;
}
