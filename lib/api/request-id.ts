import type { NextRequest } from "next/server";
import { generateRequestId } from "@/lib/agent/telemetry";

/** Prefer inbound `X-Request-ID`; otherwise generate a new id (propagate on every response). */
export function getRequestId(request: NextRequest | Request): string {
  const raw = request.headers.get("x-request-id")?.trim();
  if (raw) return raw.slice(0, 128);
  return generateRequestId();
}
