import { describe, expect, it } from "vitest";
import {
  ATTRIBUTION_CLASSES,
  ATTRIBUTION_HEX,
  ATTRIBUTION_TEXT_CLASSES,
  buildSignedAttributionColors,
} from "@/lib/landing/attributionColors";

const CANONICAL = {
  market: "#64748b",
  sector: "#0369a1",
  subsector: "#6d28d9",
  residual: "#00aa00",
} as const;

describe("landing attribution colors", () => {
  it("uses the locked cross-site factor palette", () => {
    expect({
      market: ATTRIBUTION_HEX.market.up,
      sector: ATTRIBUTION_HEX.sector.up,
      subsector: ATTRIBUTION_HEX.subsector.up,
      residual: ATTRIBUTION_HEX.residual.up,
    }).toEqual(CANONICAL);

    expect(ATTRIBUTION_CLASSES).toEqual({
      market: "bg-[#64748b]",
      sector: "bg-[#0369a1]",
      subsector: "bg-[#6d28d9]",
      residual: "bg-[#00aa00]",
    });
    expect(ATTRIBUTION_TEXT_CLASSES).toEqual({
      market: "text-[#64748b]",
      sector: "text-[#0369a1]",
      subsector: "text-[#6d28d9]",
      residual: "text-[#00aa00]",
    });
  });

  it("distinguishes negative contributions with opacity, not a different hue", () => {
    for (const layer of Object.keys(CANONICAL) as Array<keyof typeof CANONICAL>) {
      expect(ATTRIBUTION_HEX[layer].down).toBe(`${CANONICAL[layer]}99`);
    }

    expect(
      buildSignedAttributionColors({
        spy_pp: -1,
        sec_pp: 1,
        sub_pp: -1,
        res_pp: 1,
      }),
    ).toMatchObject({
      market: "#64748b99",
      sector: "#0369a1",
      subsector: "#6d28d999",
      residual: "#00aa00",
    });
  });
});
