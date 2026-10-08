import { calculateEstimatedCost } from "./capabilities";

/**
 * Charge for a per-item request once the handler knows how many items
 * actually returned data. Never above the pre-flight estimate (that is what
 * the balance and spend caps were checked against), and zero billable items
 * cost nothing — the per-call minimum applies only when something was served.
 */
export function billableCostUsd(args: {
  capabilityId: string;
  preflightCostUsd: number;
  billableItems: number;
  inputTokens?: number;
  outputTokens?: number;
  years?: number;
  grandfathered?: boolean;
}): number {
  const n = Number.isFinite(args.billableItems) ? Math.max(0, Math.floor(args.billableItems)) : 0;
  if (n === 0) return 0;
  const recomputed = calculateEstimatedCost(args.capabilityId, {
    itemCount: n,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    years: args.years,
    grandfathered: args.grandfathered,
  });
  return Math.min(args.preflightCostUsd, recomputed);
}
