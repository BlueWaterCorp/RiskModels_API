/**
 * /api/og/[ticker] — On-the-fly OG image generation
 *
 * Generates a 1200×630 social card for any ticker using @vercel/og.
 * Fetches live L3 decomposition from the internal metrics API.
 *
 * Usage:
 *   GET /api/og/NVDA → PNG image (1200×630)
 *
 * Caching: stale-while-revalidate 1 hour on Vercel CDN.
 */
import { ImageResponse } from "@vercel/og";
import {
  resolveSymbolByTicker,
  fetchLatestMetricsWithFallback,
  type V3MetricKey,
} from "@/lib/dal/risk-engine-v3";

export const runtime = "nodejs";

const OG_METRIC_KEYS: V3MetricKey[] = [
  "vol_23d", "price_close", "market_cap",
  "l3_mkt_hr", "l3_sec_hr", "l3_sub_hr",
  "l3_mkt_er", "l3_sec_er", "l3_sub_er", "l3_res_er",
];

// ── Theme constants (aligned with _theme.py Consultant Navy) ────────────
const NAVY = "#002a5e";
const TEAL = "#006f8e";
const SLATE_BG = "#0c1929";
const CARD_BG = "#111d2e";
const BORDER = "#1e3a5f";
const TEXT_PRIMARY = "#e2e8f0";
const TEXT_MUTED = "#94a3b8";
const GREEN = "#00cc66";
const RED = "#ef4444";

// Factor colors (match FACTOR_COLORS in snapshot-report-types.ts)
const FACTOR = {
  market: "#3b82f6",
  sector: "#06b6d4",
  subsector: "#f97316",
  residual: "#94a3b8",
};

// ── Helpers ─────────────────────────────────────────────────────────────
function fmtPct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function fmtHR(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toFixed(2);
}

function fmtCap(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toLocaleString()}`;
}

// ── Route Handler ───────────────────────────────────────────────────────
export async function GET(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();

  // Fetch metrics directly from DAL (no auth needed)
  const symbolRecord = await resolveSymbolByTicker(ticker);
  const latest = symbolRecord
    ? await fetchLatestMetricsWithFallback(symbolRecord.symbol, OG_METRIC_KEYS, "daily")
    : null;

  const m = (latest?.metrics ?? {}) as Record<string, number | null>;

  const vol = m.vol_23d;
  const price = m.price_close;
  const marketCap = m.market_cap;
  const teo = latest?.teo ?? "—";
  const subsectorEtf = symbolRecord?.subsector_etf ?? symbolRecord?.sector_etf ?? "—";

  // L3 decomposition
  const mktER = m.l3_mkt_er;
  const secER = m.l3_sec_er;
  const subER = m.l3_sub_er;
  const resER = m.l3_res_er;

  // Hedge ratios
  const mktHR = m.l3_mkt_hr;
  const secHR = m.l3_sec_hr;
  const subHR = m.l3_sub_hr;

  // Compute systematic % for the badge
  const totalAbsER = [mktER, secER, subER, resER]
    .filter((v): v is number => v != null)
    .reduce((s, v) => s + Math.abs(v), 0);
  const sysAbsER = [mktER, secER, subER]
    .filter((v): v is number => v != null)
    .reduce((s, v) => s + Math.abs(v), 0);
  const sysPct = totalAbsER > 0 ? Math.round((sysAbsER / totalAbsER) * 100) : null;

  // Bar chart data (horizontal stacked)
  const erValues = [
    { label: "Market", value: mktER, color: FACTOR.market },
    { label: "Sector", value: secER, color: FACTOR.sector },
    { label: "Subsector", value: subER, color: FACTOR.subsector },
    { label: "Residual", value: resER, color: FACTOR.residual },
  ];

  // Scale bars relative to max absolute value
  const maxAbs = Math.max(
    ...erValues.map((e) => Math.abs(e.value ?? 0)),
    0.001,
  );

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "1200px",
          height: "630px",
          background: SLATE_BG,
          fontFamily: "system-ui, sans-serif",
          color: TEXT_PRIMARY,
        }}
      >
        {/* ── Left Panel: Identity + Methodology ──────────────── */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: "380px",
            padding: "40px 32px",
            borderRight: `1px solid ${BORDER}`,
          }}
        >
          {/* Ticker badge */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginBottom: "8px",
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: "48px",
                fontWeight: 800,
                letterSpacing: "-1px",
                color: "#ffffff",
              }}
            >
              {ticker}
            </div>
          </div>

          {/* Subsector & date */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "2px",
              marginBottom: "24px",
            }}
          >
            <span style={{ fontSize: "14px", color: TEAL }}>
              {subsectorEtf}
            </span>
            <span style={{ fontSize: "12px", color: TEXT_MUTED }}>
              As of {teo}
            </span>
          </div>

          {/* Key metrics */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              marginBottom: "32px",
            }}
          >
            <MetricRow label="Price" value={price != null ? `$${price.toFixed(2)}` : "—"} />
            <MetricRow label="Market Cap" value={fmtCap(marketCap)} />
            <MetricRow label="Vol (23d)" value={fmtPct(vol)} />
            <MetricRow
              label="Residual α"
              value={fmtPct(resER)}
              accent={resER != null ? (resER >= 0 ? GREEN : RED) : undefined}
            />
            {sysPct != null && (
              <MetricRow label="Systematic" value={`${sysPct}%`} />
            )}
          </div>

          {/* Hedge ratios */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              padding: "16px",
              background: CARD_BG,
              borderRadius: "8px",
              border: `1px solid ${BORDER}`,
              gap: "8px",
              marginBottom: "24px",
            }}
          >
            <span
              style={{
                fontSize: "10px",
                fontWeight: 700,
                textTransform: "uppercase" as const,
                letterSpacing: "1px",
                color: TEXT_MUTED,
              }}
            >
              L3 Hedge Ratios
            </span>
            <HRRow label="β Market" value={fmtHR(mktHR)} color={FACTOR.market} />
            <HRRow label="β Sector" value={fmtHR(secHR)} color={FACTOR.sector} />
            <HRRow label="β Subsector" value={fmtHR(subHR)} color={FACTOR.subsector} />
          </div>

          {/* Methodology */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "4px",
              marginTop: "auto",
            }}
          >
            <span
              style={{
                fontSize: "9px",
                fontWeight: 700,
                textTransform: "uppercase" as const,
                letterSpacing: "1px",
                color: TEXT_MUTED,
              }}
            >
              Methodology
            </span>
            <span style={{ fontSize: "10px", color: TEXT_MUTED, lineHeight: "1.4" }}>
              Sequential Orthogonalized Regression (L1→L2→L3) for stable,
              incremental hedge ratios.
            </span>
          </div>
        </div>

        {/* ── Right Panel: L3 ER Decomposition Chart ─────────── */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            padding: "40px 40px 40px 40px",
          }}
        >
          <span
            style={{
              fontSize: "14px",
              fontWeight: 700,
              textTransform: "uppercase" as const,
              letterSpacing: "1.5px",
              color: TEXT_MUTED,
              marginBottom: "8px",
            }}
          >
            L3 Explained Risk Decomposition
          </span>
          <span
            style={{
              fontSize: "12px",
              color: TEXT_MUTED,
              marginBottom: "32px",
            }}
          >
            Daily annualized expected return by factor layer
          </span>

          {/* Bar chart */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "20px",
              flex: 1,
              justifyContent: "center",
            }}
          >
            {erValues.map((item) => (
              <div
                key={item.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "16px",
                }}
              >
                {/* Label */}
                <span
                  style={{
                    width: "100px",
                    fontSize: "14px",
                    color: item.color,
                    fontWeight: 600,
                    textAlign: "right",
                  }}
                >
                  {item.label}
                </span>

                {/* Bar track */}
                <div
                  style={{
                    display: "flex",
                    flex: 1,
                    height: "40px",
                    background: CARD_BG,
                    borderRadius: "6px",
                    position: "relative",
                    alignItems: "center",
                    overflow: "hidden",
                  }}
                >
                  {/* Center line */}
                  <div
                    style={{
                      position: "absolute",
                      left: "50%",
                      top: 0,
                      bottom: 0,
                      width: "1px",
                      background: BORDER,
                    }}
                  />
                  {/* Bar */}
                  {item.value != null && (
                    <div
                      style={{
                        position: "absolute",
                        left:
                          item.value >= 0
                            ? "50%"
                            : `${50 - (Math.abs(item.value) / maxAbs) * 45}%`,
                        width: `${(Math.abs(item.value) / maxAbs) * 45}%`,
                        height: "28px",
                        background: item.color,
                        borderRadius: "4px",
                        opacity: 0.85,
                      }}
                    />
                  )}
                </div>

                {/* Value */}
                <span
                  style={{
                    width: "70px",
                    fontSize: "14px",
                    fontWeight: 700,
                    color: TEXT_PRIMARY,
                    fontFamily: "monospace",
                  }}
                >
                  {fmtPct(item.value)}
                </span>
              </div>
            ))}
          </div>

          {/* Legend */}
          <div
            style={{
              display: "flex",
              gap: "24px",
              marginTop: "24px",
              justifyContent: "center",
            }}
          >
            {erValues.map((item) => (
              <div
                key={item.label}
                style={{ display: "flex", alignItems: "center", gap: "6px" }}
              >
                <div
                  style={{
                    width: "10px",
                    height: "10px",
                    borderRadius: "2px",
                    background: item.color,
                  }}
                />
                <span style={{ fontSize: "11px", color: TEXT_MUTED }}>
                  {item.label}
                </span>
              </div>
            ))}
          </div>

          {/* Branding */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: "20px",
              paddingTop: "16px",
              borderTop: `1px solid ${BORDER}`,
            }}
          >
            <span style={{ fontSize: "11px", color: TEXT_MUTED }}>
              riskmodels.app
            </span>
            <span style={{ fontSize: "11px", color: TEXT_MUTED }}>
              ERM3 V3 · BW Macro
            </span>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200",
      },
    },
  );
}

// ── Inline sub-components (must return JSX for Satori) ──────────────────

function MetricRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <span style={{ fontSize: "13px", color: TEXT_MUTED }}>{label}</span>
      <span
        style={{
          fontSize: "15px",
          fontWeight: 700,
          fontFamily: "monospace",
          color: accent ?? TEXT_PRIMARY,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function HRRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <span style={{ fontSize: "12px", color }}>{label}</span>
      <span
        style={{
          fontSize: "13px",
          fontWeight: 700,
          fontFamily: "monospace",
          color: TEXT_PRIMARY,
        }}
      >
        {value}
      </span>
    </div>
  );
}
