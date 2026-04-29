/**
 * RiskModels Analysis Object Model — strict types for SDK and tooling.
 * Aligns with ./AOM_SPEC.md (v1 stable). No primitives beyond the spec.
 */

export type Lens = 'return_attribution' | 'risk_decomposition' | 'exposure';

export type Resolution = 'market_only' | 'market_sector' | 'full_stack';

export type View = 'snapshot' | 'timeseries' | 'distribution';

export type OutputMode = 'structured' | 'explanation' | 'visual';

/** Valid only when lens is return_attribution or risk_decomposition; omitted means incremental. */
export type AttributionMode = 'incremental' | 'cumulative';

export type IntentShorthand =
  | 'explain_return'
  | 'reduce_risk'
  | 'find_hidden_bets'
  | 'compare_peers'
  | 'screen_universe';

export type StockSubject = {
  type: 'stock';
  ticker?: string;
  symbol?: string;
};

export type PortfolioSubject =
  | {
      type: 'portfolio';
      source: 'inline';
      holdings: Array<{ ticker: string; weight: number }>;
    }
  | {
      type: 'portfolio';
      source: 'id';
      portfolio_id: string;
    };

export type UniverseSubject = {
  type: 'universe';
  universe_id: string;
};

export type ComparisonAlignment = {
  date_range: 'shared';
  normalize: boolean;
};

export type ComparisonSubject = {
  type: 'comparison';
  subjects: Subject[];
  alignment?: ComparisonAlignment;
};

export type Subject =
  | StockSubject
  | PortfolioSubject
  | UniverseSubject
  | ComparisonSubject;

export type DateRangePreset = {
  preset: 'ytd' | 'mtd' | '1y' | '5y' | string;
};

export type DateRangeExplicit = {
  start: string;
  end: string;
};

export type Scope = {
  date_range?: DateRangePreset | DateRangeExplicit;
  as_of?: 'latest' | string;
  frequency?: 'daily' | 'monthly' | string;
  benchmark?: string;
};

/** Discriminator `kind` only — never a JSON field named "stage". See AOM_SPEC. */
export type ChainStage =
  | {
      kind: 'analyze';
      lens: Lens;
      resolution?: Resolution;
      view?: View;
      attribution_mode?: AttributionMode;
    }
  | {
      kind: 'hedge_action';
      depends_on?: 'previous' | string;
    };

export type AOMSingleRequest = {
  subject: Subject;
  scope: Scope;
  lens: Lens;
  attribution_mode?: AttributionMode;
  resolution: Resolution;
  view: View;
  output_mode: OutputMode;
  intent?: IntentShorthand;
};

export type AOMChainRequest = {
  subject: Subject;
  scope: Scope;
  chain: ChainStage[];
  output_mode: OutputMode;
  intent?: IntentShorthand;
};

export type AOMRequest = AOMSingleRequest | AOMChainRequest;

export function isChainRequest(r: AOMRequest): r is AOMChainRequest {
  return 'chain' in r && Array.isArray((r as AOMChainRequest).chain);
}

export type ExplanationConfidence = 'high' | 'medium' | 'low';

/** Required fields when output_mode is explanation; see AOM_SPEC. */
export type ExplanationOutput = {
  headline: string;
  key_drivers: string[];
  optional_metrics: Array<{ ref: string; label?: string }>;
  confidence: ExplanationConfidence;
  caveats?: string[];
};
