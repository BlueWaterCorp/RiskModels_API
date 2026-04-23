/** Subset of `GET /api/metrics/{ticker}` JSON used by playground + four-bet UI. */
export interface RiskmodelsMetricsBlock {
  l3_mkt_er: number | null;
  l3_sec_er: number | null;
  l3_sub_er: number | null;
  l3_res_er: number | null;
  l3_mkt_hr: number | null;
  l3_sec_hr: number | null;
  l3_sub_hr: number | null;
}

export interface RiskmodelsMetricsMeta {
  sector_etf: string | null;
  subsector_etf: string | null;
}

export interface RiskmodelsMetricsMetadataBody {
  model_version?: string;
  data_as_of?: string;
  factor_set_id?: string;
  universe_size?: number;
  wiki_uri?: string;
  factors?: string[];
}

export interface RiskmodelsMetricsResponse {
  ticker: string;
  symbol?: string;
  teo: string;
  periodicity?: string;
  metrics: RiskmodelsMetricsBlock;
  meta?: RiskmodelsMetricsMeta;
  _metadata?: RiskmodelsMetricsMetadataBody;
  _data_health?: {
    data_as_of?: string;
    er_populated?: boolean;
    vol_populated?: boolean;
    l1_populated?: boolean;
    l2_populated?: boolean;
  };
}

export type FourLayerKey = 'market' | 'sector' | 'subsector' | 'residual';

export interface FourBetLayer {
  er: number | null;
  hr: number | null;
  hedge_etf: string | null;
}

export type FourBetExposure = Record<FourLayerKey, FourBetLayer>;
