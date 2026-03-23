// Phase 1 stub — replaced in Phase 2 with real implementation from Risk_Models.
export interface ApiKeyResult {
  plainKey: string;
  hashedKey: string;
  prefix: string;
}

export interface ValidatedKey {
  valid: boolean;
  userId?: string;
  scopes?: string[];
  rateLimit?: number;
  error?: string;
}

export async function validateApiKey(_key: string): Promise<ValidatedKey> {
  throw new Error("stub: not yet implemented — see Phase 2");
}

export function extractApiKey(_header: string | null): string | null {
  throw new Error("stub: not yet implemented — see Phase 2");
}
