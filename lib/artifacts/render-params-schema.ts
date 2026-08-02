/**
 * Zod shape for render-svc's `params`, shared by the MCP tool and the chat tool.
 *
 * Both surfaces accepted **no** params before 2026-08-02, so an agent could not
 * set a single knob: it could ask for `top_holdings_erm_stacked` and always got
 * the default twelve rows, with no way to say ten (G.54). One schema rather
 * than two because two would drift, and the tool description is generated from
 * `ARTIFACT_SLUG_PARAMS` for the same reason.
 *
 * Bounds mirror `ArtifactParams` in `services/render-svc/render_svc/artifacts.py`.
 * They are duplicated here only to give the model a typed refusal locally
 * instead of a round trip; render-svc re-validates everything and remains the
 * authority on per-slug applicability (it 422s a param the slug does not honor).
 */

import { z } from "zod";

import {
  ARTIFACT_SLUG_PARAMS,
  type ArtifactParams,
} from "@/lib/artifacts/render-client";

export const artifactRenderParamsSchema = z.object({
  top_n: z.number().int().min(1).max(50).optional(),
  peer_n: z.number().int().min(1).max(50).optional(),
  window: z.enum(["3m", "6m", "1y", "2y", "3y", "5y", "max"]).optional(),
  sort_by: z.string().min(1).max(32).optional(),
  layers: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z]+(,[a-z]+)*$/, "layers is comma-separated lowercase levels")
    .optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
    .optional(),
  benchmark: z.string().min(1).max(64).optional(),
});

export type ArtifactRenderParamsInput = z.infer<typeof artifactRenderParamsSchema>;

/** Drop explicit `undefined`s so an all-empty object is sent as no params at all. */
export function compactParams(
  raw: ArtifactRenderParamsInput | undefined,
): ArtifactParams | undefined {
  if (!raw) return undefined;
  const entries = Object.entries(raw).filter(([, v]) => v !== undefined);
  return entries.length ? (Object.fromEntries(entries) as ArtifactParams) : undefined;
}

/**
 * Per-slug applicability, rendered for a tool description.
 *
 * Generated from `ARTIFACT_SLUG_PARAMS` so the prose a model reads cannot claim
 * a param the server will refuse — the same derived-not-written rule the
 * capability endpoint follows.
 */
export function describeSlugParams(): string {
  const byParams = Object.entries(ARTIFACT_SLUG_PARAMS)
    .map(([slug, keys]) => `${slug}: ${keys.join("+")}`)
    .sort();
  return (
    "Per-slug render params; render-svc returns 422 for a param the slug does " +
    "not honor, and each combination renders once under its own cache key. " +
    `Applicability — ${byParams.join("; ")}. Every other slug accepts none. ` +
    "`date` picks an observation inside a panel's history and is NOT the " +
    "request-level `as_of`, which picks the artifact vintage."
  );
}
