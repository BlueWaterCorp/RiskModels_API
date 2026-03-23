// Phase 1 stub — replaced in Phase 2 with real implementation from Risk_Models.
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  limit: number;
}

export async function checkRateLimit(
  _identifier: string,
  _limitPerMinute: number,
): Promise<RateLimitResult> {
  throw new Error("stub: not yet implemented — see Phase 2");
}

export function getRateLimitForKey(_scopes?: string[]): number {
  throw new Error("stub: not yet implemented — see Phase 2");
}
