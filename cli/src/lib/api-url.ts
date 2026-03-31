import { DEFAULT_API_BASE } from "./config.js";

/** User-facing base is usually `https://riskmodels.app`; SDK uses `…/api`. */
export function apiRootFromUserBase(apiBaseUrl: string | undefined): string {
  const raw = (apiBaseUrl ?? DEFAULT_API_BASE).replace(/\/$/, "");
  if (raw.endsWith("/api")) return raw;
  return `${raw}/api`;
}
