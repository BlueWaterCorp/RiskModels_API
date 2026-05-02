/**
 * 9-box style cell ↔ URL slug mapping.
 *
 * DB stores `equity_style_9box` as "Large Blend" (capitalized words, space-separated).
 * URL slugs are lowercase + hyphenated: "large-blend".
 *
 * The 9 valid cells are the cross of {Large, Mid, Small} × {Value, Blend, Growth}.
 */

export const STYLE_CELL_NAMES = [
  "Large Value",
  "Large Blend",
  "Large Growth",
  "Mid Value",
  "Mid Blend",
  "Mid Growth",
  "Small Value",
  "Small Blend",
  "Small Growth",
] as const;

export type StyleCellName = (typeof STYLE_CELL_NAMES)[number];

const NAME_TO_SLUG = new Map<string, string>(
  STYLE_CELL_NAMES.map((name) => [name, name.toLowerCase().replace(/\s+/g, "-")]),
);

const SLUG_TO_NAME = new Map<string, StyleCellName>(
  STYLE_CELL_NAMES.map((name) => [name.toLowerCase().replace(/\s+/g, "-"), name]),
);

export function styleSlugToName(slug: string): StyleCellName | null {
  return SLUG_TO_NAME.get(slug.trim().toLowerCase()) ?? null;
}

export function styleNameToSlug(name: string): string | null {
  return NAME_TO_SLUG.get(name) ?? null;
}

export function isValidStyleSlug(slug: string): boolean {
  return SLUG_TO_NAME.has(slug.trim().toLowerCase());
}
