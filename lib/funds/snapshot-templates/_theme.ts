/**
 * Consultant-navy design tokens for funds-side snapshot templates.
 *
 * Mirrors the Python `_plotly_theme` constants used by the SDK R1 stock
 * tearsheet (sdk/riskmodels/snapshots/_plotly_theme.py). Both surfaces
 * share the same brand palette so the F1 fund tearsheet (HTML/Playwright)
 * and the future Python F1 tearsheet (D.3) feel like siblings.
 *
 * Single source of truth for all visual constants — never hardcode colors
 * or font sizes inside templates / chart components.
 */

export const PALETTE = {
  navy: "#002a5e",
  teal: "#006f8e",
  slate: "#2a7fbf",
  green: "#00aa00",
  orange: "#e07000",
  red: "#c0392b",

  textDark: "#111827",
  textMid: "#4b5563",
  textLight: "#9ca3af",

  bgLight: "#f8f9fb",
  bgPanel: "#f0f4f8",
  border: "#dddddd",
  axisLine: "#e5e7eb",
  white: "#ffffff",
} as const;

/** L1 / L2 / L3 / Residual / Gross color assignments for cumulative chart paths. */
export const LAYER_COLORS = {
  l1_market: PALETTE.navy,
  l2_sector: PALETTE.teal,
  l3_subsector: PALETTE.slate,
  residual: PALETTE.orange,
  gross: PALETTE.navy,
  nav: PALETTE.green,
} as const;

export const LAYER_LABELS = {
  l1_market: "L1 Market (SPY)",
  l2_sector: "L2 Sector",
  l3_subsector: "L3 Subsector",
  residual: "L3 Residual (α)",
  gross: "Gross (13F)",
  nav: "Realized NAV",
} as const;

export const FONTS = {
  family:
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  size: {
    title: 22,
    sectionHead: 13,
    body: 11,
    smallLabel: 9,
    chip: 14,
    footer: 8,
  },
  weight: {
    bold: 700,
    semibold: 600,
    regular: 400,
  },
} as const;

/**
 * Letter landscape geometry (11 × 8.5 in). Playwright is configured to print
 * with `format: "letter"` and `landscape: true` against the template's
 * `@page { size: letter landscape; }` CSS rule — no manual scaling needed.
 */
export const PAGE = {
  width: "11in",
  height: "8.5in",
  margin: "0.4in 0.5in 0.35in 0.5in",
} as const;

/** Spacing rhythm (px). 4-multiple grid keeps section gaps consistent. */
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
} as const;

export const BORDER_RADIUS = {
  panel: 4,
  pill: 999,
} as const;
