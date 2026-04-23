import type { FourBetExposure, FourLayerKey } from '../types/metrics';
import { RISKMODELS_THEME } from '../theme';

const ORDER: FourLayerKey[] = ['market', 'sector', 'subsector', 'residual'];

const LABELS: Record<FourLayerKey, string> = {
  market: 'Market',
  sector: 'Sector',
  subsector: 'Subsector',
  residual: 'Residual',
};

const COLORS: Record<FourLayerKey, string> = {
  market: RISKMODELS_THEME.slate,
  sector: RISKMODELS_THEME.teal,
  subsector: RISKMODELS_THEME.teal,
  residual: RISKMODELS_THEME.green,
};

function fmt(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

function signedPlus(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(digits);
}

export interface Erm3FourBetCardProps {
  exposure: FourBetExposure;
  title?: string;
  asOfLabel?: string | null;
}

export function Erm3FourBetCard({
  exposure,
  title = 'Exposure (four bets)',
  asOfLabel,
}: Erm3FourBetCardProps) {
  return (
    <div style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#a1a1aa' }}>
          {title}
        </h3>
        {asOfLabel ? (
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#71717a' }}>as of {asOfLabel}</span>
        ) : null}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {ORDER.map((key) => {
          const layer = exposure[key];
          const er = layer.er ?? 0;
          const pct = Math.max(2, Math.round(er * 100));
          return (
            <li key={key}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#d4d4d8', marginBottom: 4 }}>
                <span>
                  {LABELS[key]}
                  {layer.hedge_etf ? (
                    <span style={{ marginLeft: 8, fontFamily: 'monospace', fontSize: 11, color: '#71717a' }}>
                      → {layer.hedge_etf}
                    </span>
                  ) : null}
                </span>
                <span style={{ fontFamily: 'monospace', color: '#a1a1aa' }}>
                  er {fmt(layer.er)}
                  {layer.hr !== null ? <span style={{ marginLeft: 8 }}>hr {signedPlus(layer.hr)}</span> : null}
                </span>
              </div>
              <div style={{ height: 8, borderRadius: 9999, background: '#27272a' }}>
                <div
                  style={{
                    height: '100%',
                    borderRadius: 9999,
                    width: `${pct}%`,
                    background: COLORS[key],
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export interface Erm3HedgeMapProps {
  hedge: Record<string, number>;
}

export function Erm3HedgeMap({ hedge }: Erm3HedgeMapProps) {
  const entries = Object.entries(hedge).filter(([, v]) => Number.isFinite(v) && v !== 0);
  return (
    <div style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', padding: 20 }}>
      <h3 style={{ margin: '0 0 16px', fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#a1a1aa' }}>
        Hedge map (per $1 long)
      </h3>
      {entries.length === 0 ? (
        <p style={{ fontSize: 13, color: '#71717a' }}>No hedge legs.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {entries.map(([etf, ratio]) => (
            <li
              key={etf}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(24,24,27,0.5)',
                padding: '10px 16px',
              }}
            >
              <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 600, color: '#fafafa' }}>{etf}</span>
              <span style={{ fontFamily: 'monospace', fontSize: 14, color: ratio < 0 ? '#fda4af' : '#86efac' }}>
                {signedPlus(ratio, 2)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p style={{ marginTop: 16, fontSize: 11, lineHeight: 1.5, color: '#71717a' }}>
        Negative = short the ETF per $1 long stock. Positive = long the ETF (e.g. when the stock&apos;s market HR is
        negative).
      </p>
    </div>
  );
}
