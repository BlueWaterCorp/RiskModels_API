import { describe, expect, it } from "vitest";
import {
  STYLE_CELL_NAMES,
  isValidStyleSlug,
  styleNameToSlug,
  styleSlugToName,
  styleSlugToPathComponent,
} from "@/lib/funds/style-slug";

describe("style-slug", () => {
  it("exports exactly 9 cells", () => {
    expect(STYLE_CELL_NAMES.length).toBe(9);
  });

  it("round-trips name → slug → name for every cell", () => {
    for (const name of STYLE_CELL_NAMES) {
      const slug = styleNameToSlug(name);
      expect(slug).not.toBeNull();
      expect(styleSlugToName(slug!)).toBe(name);
    }
  });

  it("normalizes slug case and whitespace", () => {
    expect(styleSlugToName("LARGE-BLEND")).toBe("Large Blend");
    expect(styleSlugToName("  large-blend  ")).toBe("Large Blend");
  });

  it("returns null for unknown slugs", () => {
    expect(styleSlugToName("mega-blend")).toBeNull();
    expect(styleSlugToName("")).toBeNull();
    expect(isValidStyleSlug("mega-blend")).toBe(false);
    expect(isValidStyleSlug("large-blend")).toBe(true);
  });

  it("returns null when name is not a 9-box cell", () => {
    expect(styleNameToSlug("Large Quality")).toBeNull();
    expect(styleNameToSlug("large blend")).toBeNull(); // case-sensitive on the DB side
  });

  it("emits hyphenated lowercase slugs", () => {
    expect(styleNameToSlug("Large Blend")).toBe("large-blend");
    expect(styleNameToSlug("Small Growth")).toBe("small-growth");
  });

  it("emits underscore path components for GCS Zarr layout", () => {
    expect(styleSlugToPathComponent("large-blend")).toBe("Large_Blend");
    expect(styleSlugToPathComponent("small-growth")).toBe("Small_Growth");
    expect(styleSlugToPathComponent("MID-VALUE")).toBe("Mid_Value");
  });

  it("returns null for unknown slug in path encoder", () => {
    expect(styleSlugToPathComponent("mega-blend")).toBeNull();
  });
});
