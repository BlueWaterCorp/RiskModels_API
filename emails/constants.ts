/**
 * Shared constants for React Email templates (developer portal at riskmodels.app).
 *
 * Links always point at the canonical API host. NEXT_PUBLIC_APP_URL is `.net` in some
 * environments, and the docs, quickstart and key pages only exist on `.app`, so emails
 * built from it sent customers to 404s.
 */
import { CANONICAL_SITE_URL } from "../lib/constants";

export const BASE_URL = CANONICAL_SITE_URL;

export const LOGO_URL = `${BASE_URL}/riskmodels-logo.svg`;
/** Raster copy of the mark (512×301, mostly empty canvas). Gmail strips SVG <img>s — use a PNG for anything that must render there. */
export const LOGO_PNG_URL = `${BASE_URL}/logo.png`;
/** Official RiskModels wordmark (gradient wave + navy text), tight-cropped for light backgrounds. Source: Logos/RiskModels_v2 snapshot_ready. ≈5.4:1. */
export const RISKMODELS_WORDMARK_URL = `${BASE_URL}/riskmodels-wordmark.png`;
/** Operating entity named on receipts, terms and the legal page. */
export const LEGAL_ENTITY = "Blue Water Macro Corp.";
/** Jurisdiction line under the entity on documents (Delaware C-Corp; API Terms governing law). */
export const LEGAL_ENTITY_JURISDICTION = "A Delaware corporation";
/** Canonical API Terms (matches README / API_TERMS.md). */
export const API_TERMS_URL = "https://riskmodels.net/terms/api";
/**
 * Account settings and support pages are served by the riskmodels.net app, not `.app`
 * (checked 2026-10-08: /settings and /support return 404 on `.app`, 200 on `.net`).
 */
export const ACCOUNT_SITE_URL = "https://riskmodels.net";
export const SUPPORT_URL = `${ACCOUNT_SITE_URL}/support`;
export const HOW_IT_WORKS_URL = `${BASE_URL}/docs`;
export const SITE_NAME = "RiskModels";
export const SUPPORT_EMAIL = "service@riskmodels.app";

/** Resend `from` when `RESEND_FROM_EMAIL` is unset (must match a verified sender in Resend). */
export const DEFAULT_RESEND_FROM = "RiskModels <service@riskmodels.app>";
