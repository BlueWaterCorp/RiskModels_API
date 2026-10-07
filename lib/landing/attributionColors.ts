export const ATTRIBUTION_HEX = {
  gross: "#94a3b8",
  market: { up: "#64748b", down: "#64748b99" },
  sector: { up: "#0369a1", down: "#0369a199" },
  subsector: { up: "#6d28d9", down: "#6d28d999" },
  residual: { up: "#00aa00", down: "#00aa0099" },
} as const;

export const ATTRIBUTION_CLASSES = {
  market: "bg-[#64748b]",
  sector: "bg-[#0369a1]",
  subsector: "bg-[#6d28d9]",
  residual: "bg-[#00aa00]",
} as const;

export const ATTRIBUTION_TEXT_CLASSES = {
  market: "text-[#64748b]",
  sector: "text-[#0369a1]",
  subsector: "text-[#6d28d9]",
  residual: "text-[#00aa00]",
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
