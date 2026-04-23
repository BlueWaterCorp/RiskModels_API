import type { RiskmodelsMetricsResponse } from '../types/metrics';

export interface LineageStampProps {
  body: RiskmodelsMetricsResponse;
  className?: string;
}

/** Small monospace lineage block (data_as_of, teo, model version). */
export function LineageStamp({ body, className }: LineageStampProps) {
  const md = body._metadata;
  const dataAsOf = md?.data_as_of ?? body._data_health?.data_as_of ?? '—';
  const teo = body.teo ?? '—';
  const model = md?.model_version ?? '—';
  const factorSet = md?.factor_set_id ?? '—';

  return (
    <pre
      className={className}
      style={{
        margin: 0,
        fontSize: 11,
        lineHeight: 1.5,
        color: '#a1a1aa',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      }}
    >
      {`Call:       GET /api/metrics/${body.ticker}
data_as_of: ${dataAsOf}
teo:        ${teo}
model:      ${model}
factor_set: ${factorSet}`}
    </pre>
  );
}
