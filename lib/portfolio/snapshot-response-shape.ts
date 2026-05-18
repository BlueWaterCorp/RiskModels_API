/**
 * Optional response shaping for POST /api/snapshot (smaller payloads for agents).
 */

export type SnapshotBody = Record<string, unknown>;

/** When compact, omit long daily time series; keep snapshot table + risk summary. */
export function applySnapshotResponseOptions(
  body: SnapshotBody,
  opts: { compact: boolean },
): SnapshotBody {
  if (!opts.compact) return body;
  const next = { ...body };
  delete next.time_behavior;
  delete next.attribution;
  return next;
}

export function snapshotWantsCompact(request: {
  nextUrl: URL;
  headers: Headers;
}): boolean {
  const q = request.nextUrl.searchParams.get("compact");
  if (q === "1" || q === "true" || q === "yes") return true;
  const prefer = request.headers.get("prefer")?.toLowerCase() ?? "";
  return prefer.includes("return=minimal");
}
