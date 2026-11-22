/**
 * One sanitizer for every `next` / redirect parameter the sign-in flow consumes
 * (auth callback, /get-key). Only same-origin relative paths pass.
 *
 * Rejected: absolute URLs, protocol-relative `//host`, `/\host` (browsers treat
 * `\` as `/`), any backslash or control character (tab/newline are stripped by
 * URL parsers, so `/\t/host` becomes `//host`), and the same shapes hidden
 * behind percent-encoding in the path.
 */

const MAX_REDIRECT_LEN = 2048;
const MAX_DECODE_PASSES = 4;
/** C0/C1 controls, DEL, and the Unicode line/paragraph separators. */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029) return true;
  }
  return false;
}
/** Fixed parse base; the value must resolve back onto it. */
const PARSE_BASE = "https://redirect.invalid";

function pathIsUnsafe(path: string): boolean {
  return (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    hasControlChar(path)
  );
}

/** Returns the path when it is a safe same-origin relative path, else null. */
export function sanitizeRedirectPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (!raw || raw.length > MAX_REDIRECT_LEN) return null;
  // No trimming: leading/trailing whitespace is itself a rejection reason.
  if (raw !== raw.trim()) return null;
  if (raw.includes("\\") || hasControlChar(raw)) return null;
  if (pathIsUnsafe(raw)) return null;

  // Check the path component again after percent-decoding, so `/%2F%2Fhost`,
  // `/%5Chost` and `/%09/host` cannot slip through. The query string is left
  // alone: it legitimately carries encoded URLs (OAuth redirect_uri).
  const cut = raw.search(/[?#]/);
  let path = cut === -1 ? raw : raw.slice(0, cut);
  for (let i = 0; i < MAX_DECODE_PASSES; i++) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      return null;
    }
    if (pathIsUnsafe(decoded)) return null;
    if (decoded === path) break;
    if (i === MAX_DECODE_PASSES - 1) return null; // still changing: refuse
    path = decoded;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw, PARSE_BASE);
  } catch {
    return null;
  }
  if (parsed.origin !== PARSE_BASE) return null;
  if (parsed.pathname.startsWith("//")) return null;
  return raw;
}

/** Sanitized path, or `fallback` when the value is missing or unsafe. */
export function safeRedirectPath(raw: unknown, fallback = "/get-key"): string {
  return sanitizeRedirectPath(raw) ?? fallback;
}
