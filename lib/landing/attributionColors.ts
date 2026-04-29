export const ATTRIBUTION_HEX = {
  gross: "#94A3B8",
  market: { up: "#64748B", down: "#475569" },
  sector: { up: "#0D9488", down: "#134E4A" },
  subsector: { up: "#8B5CF6", down: "#5B21B6" },
  residual: { up: "#10B981", down: "#064E3B" },
} as const;

export const ATTRIBUTION_CLASSES = {
  market: "bg-slate-500",
  sector: "bg-teal-600",
  subsector: "bg-violet-500",
  residual: "bg-emerald-500",
} as const;

export const ATTRIBUTION_TEXT_CLASSES = {
  market: "text-slate-400",
  sector: "text-teal-400",
  subsector: "text-violet-400",
  residual: "text-emerald-400",
} as const;

export type SignedAttributionColors = {
  gross: string;
  market: string;
  sector: string;
  subsector: string;
  residual: string;
};

export type AttributionBar = {
  spy_pp: number;
  sec_pp: number;
  sub_pp: number;
  res_pp: number;
};

export type AttributionSeriesKey =
  | "gross"
  | "marketHedged"
  | "sectorHedged"
  | "subsectorHedged"
  | "residual";

export type AttributionSeries = {
  key: AttributionSeriesKey;
  label: string;
  color: string;
  dash?: string;
};

export type AttributionLegendItem = Omit<AttributionSeries, "key"> & {
  key: AttributionSeries["key"] | "subsector";
};

export function signedColor(up: string, down: string, value: number): string {
  return value >= 0 ? up : down;
}

export function buildSignedAttributionColors(
  bar: AttributionBar,
): SignedAttributionColors {
  return {
    gross: ATTRIBUTION_HEX.gross,
    market: signedColor(
      ATTRIBUTION_HEX.market.up,
      ATTRIBUTION_HEX.market.down,
      bar.spy_pp,
    ),
    sector: signedColor(
      ATTRIBUTION_HEX.sector.up,
      ATTRIBUTION_HEX.sector.down,
      bar.sec_pp,
    ),
    subsector: signedColor(
      ATTRIBUTION_HEX.subsector.up,
      ATTRIBUTION_HEX.subsector.down,
      bar.sub_pp,
    ),
    residual: signedColor(
      ATTRIBUTION_HEX.residual.up,
      ATTRIBUTION_HEX.residual.down,
      bar.res_pp,
    ),
  };
}

export function seriesWithSignedColors(
  colors: SignedAttributionColors,
): AttributionSeries[] {
  return [
    { key: "marketHedged", label: "Market", color: colors.market },
    { key: "sectorHedged", label: "Sector", color: colors.sector },
    { key: "subsectorHedged", label: "Subsector", color: colors.subsector },
    { key: "residual", label: "Residual", color: colors.residual },
    { key: "gross", label: "Gross", color: colors.gross, dash: "6 4" },
  ];
}

export function legendItemsWithSignedColors(
  colors: SignedAttributionColors,
): AttributionLegendItem[] {
  return [
    { key: "marketHedged", label: "Market", color: colors.market },
    { key: "sectorHedged", label: "Sector", color: colors.sector },
    { key: "subsector", label: "Subsector", color: colors.subsector },
    { key: "residual", label: "Residual", color: colors.residual },
    { key: "gross", label: "Gross", color: colors.gross, dash: "6 4" },
  ];
}
