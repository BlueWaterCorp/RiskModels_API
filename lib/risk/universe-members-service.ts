/**
 * Universe membership service (R.8).
 *
 * Thin shaping layer over the zarr-reader. Active members = universe_mask AND
 * validity at the requested teo. The universe mask is monthly (stamped at
 * month-end and applied to every teo in the following month); validity is
 * daily. Symbols failing either gate are NOT in the response. See
 * lib/dal/zarr-reader.ts::readUniverseMembers for the underlying read.
 */

import {
  readUniverseMembers,
  type UniverseMembersResult,
} from "@/lib/dal/zarr-reader";

export type { UniverseMember, UniverseMembersResult } from "@/lib/dal/zarr-reader";

export interface UniverseMembersOptions {
  teo?: string;
}

/**
 * Resolve the active membership of a named universe at a teo (latest by default).
 * Returns null when the masks zarr is unavailable, when the requested universe
 * label has no mask variable, or when the requested teo is outside coverage.
 */
export async function getUniverseMembers(
  universe: string,
  opts: UniverseMembersOptions = {},
): Promise<UniverseMembersResult | null> {
  return readUniverseMembers(universe, opts.teo);
}
