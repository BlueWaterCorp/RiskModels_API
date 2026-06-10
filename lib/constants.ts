export const RISK_MODEL_VERSION = "3.0";

/**
 * Canonical public marketing domain. Fixed to .app on purpose — NEXT_PUBLIC_APP_URL
 * (what getAppUrl() reads) is .net in some envs, which is the legacy/terms host, not
 * the indexable site. Use this for SEO surfaces (sitemap, robots Sitemap directive).
 */
export const CANONICAL_SITE_URL = "https://riskmodels.app";

/** Canonical methodology / provenance URL surfaced to agents (response _agent.provenance, _metadata.wiki_uri). */
export const METHODOLOGY_URL = `${CANONICAL_SITE_URL}/docs/methodology`;
