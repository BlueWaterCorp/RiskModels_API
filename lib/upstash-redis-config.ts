/**
 * Detect real Upstash REST credentials vs empty / doc placeholders.
 * Placeholders like `https://...` are truthy but make @upstash/redis throw at construct time,
 * which breaks `next build` when those values are set on Vercel by mistake.
 */
export function isUpstashRedisConfigured(): boolean {
  const rawUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const rawToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!rawUrl || !rawToken) return false;

  if (!rawUrl.startsWith("https://")) return false;

  let hostname: string;
  try {
    hostname = new URL(rawUrl).hostname;
  } catch {
    return false;
  }

  if (!hostname || hostname === "...") return false;
  // Upstash hosts are always multi-label (e.g. *.upstash.io)
  if (!hostname.includes(".") || hostname.length < 6) return false;

  if (rawToken === "..." || rawToken.length < 10) return false;

  return true;
}
