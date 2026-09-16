/**
 * Shared constants for React Email templates (developer portal at riskmodels.app).
 * Uses NEXT_PUBLIC_APP_URL at render time for staging / production / local dev.
 */

export const BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://riskmodels.app";

export const LOGO_URL = `${BASE_URL}/riskmodels-logo.svg`;
/** Raster copy of the mark (512×301). Gmail strips SVG <img>s — use this for anything that must render there. */
export const LOGO_PNG_URL = `${BASE_URL}/logo.png`;
/** Operating entity named on receipts, terms and the legal page. */
export const LEGAL_ENTITY = "Blue Water Macro Corp.";
/** Canonical API Terms (matches README / API_TERMS.md). */
export const API_TERMS_URL = "https://riskmodels.net/terms/api";
export const SUPPORT_URL = `${BASE_URL}/support`;
export const HOW_IT_WORKS_URL = `${BASE_URL}/docs`;
export const SITE_NAME = "RiskModels";
export const SUPPORT_EMAIL = "service@riskmodels.app";

/** Resend `from` when `RESEND_FROM_EMAIL` is unset (must match a verified sender in Resend). */
export const DEFAULT_RESEND_FROM = "RiskModels <service@riskmodels.app>";
