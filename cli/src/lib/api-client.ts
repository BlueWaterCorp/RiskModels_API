import type { ResolvedApiAuth } from "./credentials.js";
import { getAuthorizationHeader } from "./credentials.js";

/** Thrown on non-2xx API responses so callers can inspect `status` (e.g. retries on 503). */
export class ApiHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiHttpError";
    this.status = status;
  }
}

export type ApiJsonResult = {
  body: unknown;
  costUsd?: string;
  status: number;
  headers: Headers;
};

function errorMessageFromBody(body: unknown): string {
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    const msg = o.message ?? o.error;
    if (typeof msg === "string" && msg.trim()) return msg;
    const detail = o.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
  }
  return "";
}

export async function apiFetchJson(
  auth: ResolvedApiAuth,
  method: string,
  path: string,
  options?: {
    query?: Record<string, string | number | boolean | undefined | null>;
    jsonBody?: unknown;
  },
): Promise<ApiJsonResult> {
  const url = buildUrl(auth.apiRoot, path, options?.query);
  // Single attempt: the retry existed only to refresh an expiring OAuth access
  // token, and auth is now a static API key with nothing to refresh.
  const headers = await getAuthorizationHeader(auth);
  const init: RequestInit = {
    method,
    headers: {
      ...headers,
      Accept: "application/json",
      ...(options?.jsonBody !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: options?.jsonBody !== undefined ? JSON.stringify(options.jsonBody) : undefined,
  };
  const res = await fetch(url, init);
  const costUsd = res.headers.get("x-api-cost-usd") ?? undefined;
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const msg = errorMessageFromBody(body) || `HTTP ${res.status}`;
    throw new ApiHttpError(res.status, msg);
  }
  return { body, costUsd, status: res.status, headers: res.headers };
}

export async function apiFetchOptionalAuth(
  apiRoot: string,
  method: string,
  path: string,
  options?: {
    query?: Record<string, string | number | boolean | undefined | null>;
    jsonBody?: unknown;
    auth?: ResolvedApiAuth | null;
    signal?: AbortSignal;
  },
): Promise<ApiJsonResult> {
  const url = buildUrl(apiRoot, path, options?.query);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options?.auth) {
    Object.assign(headers, await getAuthorizationHeader(options.auth));
  }
  if (options?.jsonBody !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(url, {
    method,
    headers,
    body: options?.jsonBody !== undefined ? JSON.stringify(options.jsonBody) : undefined,
    signal: options?.signal,
  });
  const costUsd = res.headers.get("x-api-cost-usd") ?? undefined;
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const msg = errorMessageFromBody(body) || `HTTP ${res.status}`;
    throw new ApiHttpError(res.status, msg);
  }
  return { body, costUsd, status: res.status, headers: res.headers };
}

function buildUrl(
  apiRoot: string,
  path: string,
  query?: Record<string, string | number | boolean | undefined | null>,
): string {
  const base = apiRoot.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  const u = new URL(base + p);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      u.searchParams.set(k, String(v));
    }
  }
  return u.toString();
}
