/**
 * Shared constants for React Email templates (developer portal at riskmodels.app).
 * Uses NEXT_PUBLIC_APP_URL at render time for staging / production / local dev.
 */

export const BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://riskmodels.app";

export const LOGO_URL = `${BASE_URL}/riskmodels-logo.svg`;
/** Raster copy of the mark (512×301, mostly empty canvas). Gmail strips SVG <img>s — use a PNG for anything that must render there. */
export const LOGO_PNG_URL = `${BASE_URL}/logo.png`;
/** The mark cropped to its ink (≈2:1, transparent, hi-res) — size it by height next to text. */
export const LOGO_MARK_URL = `${BASE_URL}/logo-mark.png`;
/** Operating entity named on receipts, terms and the legal page. */
export const LEGAL_ENTITY = "Blue Water Macro Corp.";
/** Jurisdiction line under the entity on documents (Delaware C-Corp; API Terms governing law). */
export const LEGAL_ENTITY_JURISDICTION = "A Delaware corporation";
/** Canonical API Terms (matches README / API_TERMS.md). */
export const API_TERMS_URL = "https://riskmodels.net/terms/api";
export const SUPPORT_URL = `${BASE_URL}/support`;
export const HOW_IT_WORKS_URL = `${BASE_URL}/docs`;
export const SITE_NAME = "RiskModels";
export const SUPPORT_EMAIL = "service@riskmodels.app";

/** Resend `from` when `RESEND_FROM_EMAIL` is unset (must match a verified sender in Resend). */
export const DEFAULT_RESEND_FROM = "RiskModels <service@riskmodels.app>";
