import { NextResponse, type NextRequest } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import { fetchFiler, type FilerRow } from "@/lib/dal/filers-engine";
import {
  isSyntheticEntityId,
  readFilerHoldingsTopN,
  readSyntheticEntityMeta,
  type SyntheticEntityMeta,
} from "@/lib/dal/funds-zarr-reader";
import { enrichFilerHoldingsWithL3 } from "@/lib/13f/enrich-filer-holdings";

export const dynamic = "force-dynamic";

const DEFAULT_TOP_N = 25;
const MAX_TOP_N = 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/13f/filers/{bw_filer_id}/holdings?limit=25&as_of=YYYY-MM-DD
 *
 * Top-N holdings at the filer's latest teo — or, with `as_of`, at the
 * latest quarter *known* by that date (D.8.39 knowledge mode: selection on
 * `filing_date <= as_of`; falls back to `report_date <= as_of` on zarrs
 * without per-teo filing dates, with the basis echoed as `as_of_basis`).
 * Reads per-filer ds_ph.zarr from GCS. Each holding carries `security_id`
 * (post-D.8.1 = bw_sym_id; pre-migration = a raw 9-char security
 * identifier), `adj_mv`, `weight` (fraction of total in-portfolio AUM),
 * and — when resolvable from the registry — display labels (`ticker`,
 * `name`) plus latest L3 explained-risk shares (same enrichment as the
 * snapshot endpoint).
 *
 * Bi-temporal stamps are body fields (`report_date`, `filing_date`) so
 * SDK/MCP consumers see them, mirrored on the X-Data-As-Of /
 * X-Data-Filing-Date headers.
 *
 * Default `limit = 25`; caller can request up to 1000.
 *
 * Composite entities (BW-SYNTH-*) are served by the same route; registry-only
 * fields (cik, filer_type, aum_tier) return null.
 */
export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const segments = request.nextUrl.pathname.split("/");
    const bwFilerId = segments[segments.length - 2];
    if (!bwFilerId) {
      return NextResponse.json(
        { error: "bw_filer_id is required" },
        { status: 400 },
      );
    }

    const limitParam = request.nextUrl.searchParams.get("limit");
    let limit = DEFAULT_TOP_N;
    if (limitParam !== null) {
      const parsed = Number(limitParam);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return NextResponse.json(
          { error: "limit must be a positive integer" },
          { status: 400 },
        );
      }
      limit = Math.min(Math.floor(parsed), MAX_TOP_N);
    }

    const asOf = request.nextUrl.searchParams.get("as_of") ?? undefined;
    if (asOf && !ISO_DATE.test(asOf)) {
      return NextResponse.json(
        { error: "as_of must be YYYY-MM-DD" },
        { status: 400 },
      );
    }

    // Synthetic composite entities (BW-SYNTH-*) are served by the same
    // route: no registry row, entity resolves from its zarr attrs.
    const synthetic = isSyntheticEntityId(bwFilerId);
    let filer: FilerRow | null = null;
    let synthMeta: SyntheticEntityMeta | null = null;
    if (synthetic) {
      synthMeta = await readSyntheticEntityMeta(bwFilerId);
      if (!synthMeta) {
        return NextResponse.json({ error: "Entity not found" }, { status: 404 });
      }
    } else {
      filer = await fetchFiler(bwFilerId);
      if (!filer) {
        return NextResponse.json({ error: "Filer not found" }, { status: 404 });
      }
    }

    const snapshot = await enrichFilerHoldingsWithL3(
      await readFilerHoldingsTopN(bwFilerId, limit, asOf),
    );
    if (!snapshot) {
      return NextResponse.json(
        {
          error: asOf
            ? "No holdings were known for this filer as of the requested date"
            : "No holdings panel available for this filer",
          bw_filer_id: bwFilerId,
          ...(asOf ? { as_of: asOf } : {}),
        },
        { status: 404 },
      );
    }

    const headers = new Headers({ "X-Data-As-Of": snapshot.teo });
    if (snapshot.filing_date) {
      headers.set("X-Data-Filing-Date", snapshot.filing_date);
    } else if (filer?.latest_filing_date) {
      headers.set("X-Data-Filing-Date", filer.latest_filing_date);
    }

    return NextResponse.json(
      {
        bw_filer_id: bwFilerId,
        ...(synthetic
          ? {
              entity_kind: "synthetic_composite" as const,
              evidence_class: "reconstructed" as const,
            }
          : {}),
        cik: filer?.cik ?? null,
        name: synthetic ? synthMeta!.name : (filer?.name ?? null),
        filer_type: filer?.filer_type ?? null,
        aum_tier: filer?.aum_tier ?? null,
        ...(asOf ? { as_of: asOf } : {}),
        ...snapshot,
      },
      { headers },
    );
  },
  { capabilityId: "filer-holdings" },
);
