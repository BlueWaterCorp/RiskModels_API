'use client';

import { useEffect, useState } from 'react';
import { ATTRIBUTION_HEX } from '@/lib/landing/attributionColors';

type Layer = {
  key: 'market' | 'sector' | 'subsector' | 'residual';
  label: string;
  value: number;
  color: string;
  emphasis?: boolean;
};

const LAYERS: Layer[] = [
  { key: 'market',    label: 'Market',    value: 68.0, color: ATTRIBUTION_HEX.market.up },
  { key: 'sector',    label: 'Sector',    value: 11.9, color: ATTRIBUTION_HEX.sector.up },
  { key: 'subsector', label: 'Subsector', value: 12.8, color: ATTRIBUTION_HEX.subsector.up },
  { key: 'residual',  label: 'Residual',  value: 12.5, color: ATTRIBUTION_HEX.residual.up, emphasis: true },
];

const W = 360;
const H = 260;
const PADDING_X = 18;
const ROW_LABEL_X = 100;
const BAR_X = 110;
const BAR_MAX = W - PADDING_X - BAR_X;
const ROW_HEIGHT = 34;
const ROW_TOP = 78;
const BAR_HEIGHT = 22;
const MAX_VALUE = 70;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export default function MiniDecomposition({ className }: { className?: string }) {
  const [residualVisible, setResidualVisible] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setResidualVisible(true);
      return;
    }
    const t = window.setTimeout(() => setResidualVisible(true), 220);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height="auto"
        role="img"
        aria-label="Mini decomposition of NVDA into market, sector, subsector, and residual exposures"
        className="block"
      >
        <defs>
          <linearGradient id="mini-card-bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0F172A" />
            <stop offset="100%" stopColor="#020617" />
          </linearGradient>
        </defs>

        <rect x="0" y="0" width={W} height={H} rx="14" fill="url(#mini-card-bg)" />
        <rect x="0" y="0" width={W} height={H} rx="14" fill="none" stroke="rgba(255,255,255,0.08)" />

        <text x={PADDING_X} y={28} fontSize="11" letterSpacing="2" fill="#71717A" fontWeight="700">
          NVDA
        </text>
        <text
          x={PADDING_X}
          y={50}
          fontSize="12"
          fill="#A1A1AA"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        >
          decompose(&quot;NVDA&quot;)
        </text>

        {LAYERS.map((layer, i) => {
          const y = ROW_TOP + i * ROW_HEIGHT;
          const barWidth = Math.max(8, (Math.abs(layer.value) / MAX_VALUE) * BAR_MAX);
          const isResidual = layer.key === 'residual';
          const opacity = isResidual ? (residualVisible ? 1 : 0) : 1;

          return (
            <g key={layer.key} style={{ opacity, transition: 'opacity 600ms ease-out' }}>
              <text
                x={ROW_LABEL_X - 8}
                y={y + BAR_HEIGHT / 2 + 4}
                fontSize="11"
                fill={layer.emphasis ? '#E4E4E7' : '#A1A1AA'}
                fontWeight={layer.emphasis ? 600 : 500}
                textAnchor="end"
              >
                {layer.label}
              </text>
              <rect
                x={BAR_X}
                y={y}
                width={BAR_MAX}
                height={BAR_HEIGHT}
                rx={3}
                fill="rgba(255,255,255,0.04)"
              />
              <rect
                x={BAR_X}
                y={y}
                width={barWidth}
                height={BAR_HEIGHT}
                rx={3}
                fill={layer.color}
                opacity={layer.emphasis ? 1 : 0.85}
              />
              <text
                x={BAR_X + barWidth + 8}
                y={y + BAR_HEIGHT / 2 + 4}
                fontSize="11"
                fill={layer.emphasis ? '#34D399' : '#71717A'}
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                fontWeight={layer.emphasis ? 600 : 500}
              >
                {layer.value >= 0 ? '+' : ''}
                {layer.value.toFixed(1)}
              </text>
            </g>
          );
        })}

        <text
          x={PADDING_X}
          y={H - 16}
          fontSize="10"
          fill="#52525B"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        >
          residual = what you actually own
        </text>
      </svg>
    </div>
  );
}
