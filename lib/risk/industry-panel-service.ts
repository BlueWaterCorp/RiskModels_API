/**
 * Industry panel service — cross-section from ds_erm3_industry zarr.
 *
 * Vasicek peer β statistics. Default response is (teo × industry × level);
 * `by=fact` is (teo × industry × fact) once the store is rekeyed.
 * See ERM3/docs/MACRO_STAT_ARB_ZARR_GUIDE.md §1.
 */

import {
  readIndustryPanelSnapshot,
  IndustryPanelFactAxisUnavailable,
  type IndustryPanelBy,
  type IndustryPanelKey,
  type IndustryPanelLevel,
  type IndustryPanelRow,
} from "@/lib/dal/zarr-reader";
import { getZarrFactorSetId } from "@/lib/zarr-config";

export { IndustryPanelFactAxisUnavailable };
export type { IndustryPanelBy, IndustryPanelKey, IndustryPanelLevel, IndustryPanelRow };

export interface IndustryPanelResult {
  teo: string;
  industries: IndustryPanelRow[];
  level?: IndustryPanelLevel;
  by: IndustryPanelBy;
  panel_key: IndustryPanelKey;
  min_peers: number;
  market_factor_etf: string;
  universe: string;
  data_source: string;
}

export class IndustryPanelService {
  async getPanel(
    marketFactorEtf: string,
    options: {
      teo?: string;
      level?: IndustryPanelLevel;
      minPeers?: number;
      by?: IndustryPanelBy;
    } = {},
  ): Promise<IndustryPanelResult | null> {
    const snapshot = await readIndustryPanelSnapshot({
      teo: options.teo,
      level: options.level,
      minPeers: options.minPeers,
      by: options.by,
    });

    if (!snapshot.teo) return null;

    return {
      teo: snapshot.teo,
      industries: snapshot.rows,
      ...(options.level ? { level: options.level } : {}),
      by: snapshot.by,
      panel_key: snapshot.panel_key,
      min_peers: snapshot.min_peers,
      market_factor_etf: marketFactorEtf,
      universe: getZarrFactorSetId(),
      data_source: "zarr",
    };
  }
}

let _service: IndustryPanelService | null = null;

export function getIndustryPanelService(): IndustryPanelService {
  if (!_service) _service = new IndustryPanelService();
  return _service;
}
