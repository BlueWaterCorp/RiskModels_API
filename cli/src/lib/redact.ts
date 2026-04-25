export function redactSecret(value: string | undefined | null, visiblePrefix = 6, visibleSuffix = 4): string {
  if (!value) return "(not set)";
  const trimmed = value.trim();
  if (!trimmed) return "(not set)";
  if (trimmed.length <= visiblePrefix + visibleSuffix) return "***";
  return `${trimmed.slice(0, visiblePrefix)}...${trimmed.slice(-visibleSuffix)}`;
}

export function redactJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactJson(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/key|secret|token|authorization/i.test(key) && typeof item === "string") {
      out[key] = redactSecret(item);
    } else {
      out[key] = redactJson(item);
    }
  }
  return out;
}
