/**
 * Ticker resolution for US dual- and multi-class equities.
 *
 * Two relations live here, deliberately kept apart:
 *
 *   NOTATION_ALIASES  — the same security written a different way. `BRK.B`,
 *                       `BRKB` and `BRK-B` are all Berkshire Class B. Rewriting
 *                       one to another changes nothing a caller could observe,
 *                       so it needs no disclosure.
 *
 *   class projections — a *different* security, answered with a sibling share
 *                       class's numbers. Only one class of a dual-class company
 *                       carries a modelled return series, so a request for the
 *                       other class is served from its sibling. That substitutes
 *                       one security for another and MUST be reported to the
 *                       caller.
 *
 * Collapsing the two is the G.35 defect: `/stocks/GOOGL` rendered GOOG's
 * decomposition to the digit with nothing marking it as Class C's, while
 * `/stocks/BRK-A` 404'd — one situation handled two different ways.
 *
 * Projections come from `public.class_projections_current` (H.144) — the
 * current-state face of the `security_company_map` mirror, ERM3's
 * point-in-time company/share-class map (H.137). The full PIT table (with
 * `valid_from`/`valid_to`) is mirrored alongside; an as-of read queries the
 * base table with an explicit date. The table is fetched once and cached
 * in-process; when it is unreachable or empty the resolver falls back to
 * `FALLBACK_CLASS_PROJECTIONS` — the two hand-written entries that predate the
 * mirror — so the badge degrades to its pre-H.144 coverage rather than
 * breaking.
 */

/** A share class answered with a sibling class's modelled series. */
interface ClassProjection {
  /** Ticker whose modelled series actually answers the request. */
  modelledTicker: string;
  /** Share class of the requested ticker, e.g. "A". Null when unknown. */
  requestedClass: string | null;
  /** Share class of the modelled ticker, e.g. "C". Null when unknown. */
  modelledClass: string | null;
}

/**
 * Same security, different notation. Applied before projection, so `BRKA`
 * normalizes to `BRK-A` and *then* projects onto `BRK-B` — two distinct steps,
 * only the second of which is disclosed.
 */
const NOTATION_ALIASES: Record<string, string> = {
  "BRK.A": "BRK-A",
  BRKA: "BRK-A",
  "BRK.B": "BRK-B",
  BRKB: "BRK-B",
};

/**
 * Hand-written floor for the projection table: Alphabet Class A onto Class C,
 * Berkshire Class A onto Class B. Two jobs:
 *
 *  1. Degradation path — when the `class_projections_current` mirror is
 *     unreachable or empty, resolution behaves exactly as it did before H.144.
 *  2. Class-letter overlay — EDGAR's ticker strings only carry the class for
 *     dash-suffixed tickers (`BRK-A` → "A"); stem-class tickers like GOOGL are
 *     deliberately not parsed (see ERM3 `share_class_from_ticker`). When the
 *     mirror row agrees with an entry here on the (requested → modelled) pair
 *     but lacks class letters, the letters below fill them in, keeping the
 *     GOOGL badge copy ("Class A — modeled on Class C") identical.
 */
const FALLBACK_CLASS_PROJECTIONS: Record<string, ClassProjection> = {
  GOOGL: { modelledTicker: "GOOG", requestedClass: "A", modelledClass: "C" },
  "BRK-A": { modelledTicker: "BRK-B", requestedClass: "A", modelledClass: "B" },
};

/** How long a fetched projection table is served before re-fetching. */
const PROJECTIONS_TTL_MS = 10 * 60 * 1000;
/** How long a failed/empty fetch is remembered before retrying. */
const PROJECTIONS_RETRY_MS = 60 * 1000;

interface ProjectionsCache {
  /** Null means the last fetch failed or returned nothing — use the fallback. */
  table: Record<string, ClassProjection> | null;
  expiresAt: number;
}

let projectionsCache: ProjectionsCache | null = null;
let projectionsInflight: Promise<Record<string, ClassProjection> | null> | null =
  null;

/** Test hook: drop the in-process cache so the next call re-fetches. */
export function _resetClassProjectionsCache(): void {
  projectionsCache = null;
  projectionsInflight = null;
}

interface ProjectionRow {
  requested_ticker: string | null;
  requested_class: string | null;
  modelled_ticker: string | null;
  modelled_class: string | null;
}

/**
 * Fetch the current-state projection pairs from Supabase. Returns null on any
 * failure or an empty table — the caller then uses the hand-written fallback,
 * never a broken half-table.
 */
async function fetchClassProjections(): Promise<Record<
  string,
  ClassProjection
> | null> {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return null;
  }
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("class_projections_current")
      .select("requested_ticker, requested_class, modelled_ticker, modelled_class")
      .limit(10000);
    if (error) {
      console.error("[ticker-aliases] Error fetching class projections:", error);
      return null;
    }
    const rows = (data ?? []) as ProjectionRow[];
    const table: Record<string, ClassProjection> = {};
    for (const row of rows) {
      const requested = (row.requested_ticker ?? "").trim().toUpperCase();
      const modelled = (row.modelled_ticker ?? "").trim().toUpperCase();
      if (!requested || !modelled || requested === modelled) continue;
      // A requested ticker with two currently-modelled siblings would mean the
      // company grouping upstream is wrong; ERM3 refuses to build such rows
      // (choose_modelled_class), so first-write-wins here is a formality.
      if (table[requested]) continue;
      const fallback = FALLBACK_CLASS_PROJECTIONS[requested];
      const overlay =
        fallback && fallback.modelledTicker === modelled ? fallback : null;
      table[requested] = {
        modelledTicker: modelled,
        requestedClass:
          row.requested_class?.trim() || overlay?.requestedClass || null,
        modelledClass:
          row.modelled_class?.trim() || overlay?.modelledClass || null,
      };
    }
    return Object.keys(table).length > 0 ? table : null;
  } catch (error) {
    console.error("[ticker-aliases] Error fetching class projections:", error);
    return null;
  }
}

/**
 * The projection table currently in force: the mirrored table when available,
 * otherwise the hand-written fallback. Cached in-process; concurrent callers
 * share one fetch.
 */
async function getClassProjections(): Promise<Record<string, ClassProjection>> {
  const now = Date.now();
  if (projectionsCache && projectionsCache.expiresAt > now) {
    return projectionsCache.table ?? FALLBACK_CLASS_PROJECTIONS;
  }
  if (!projectionsInflight) {
    projectionsInflight = fetchClassProjections()
      .then((table) => {
        projectionsCache = {
          table,
          expiresAt:
            Date.now() + (table ? PROJECTIONS_TTL_MS : PROJECTIONS_RETRY_MS),
        };
        return table;
      })
      .finally(() => {
        projectionsInflight = null;
      });
  }
  const table = await projectionsInflight;
  return table ?? FALLBACK_CLASS_PROJECTIONS;
}

export interface TickerResolution {
  /** Uppercased, trimmed input, as the caller asked for it. */
  requested: string;
  /** Ticker to look up in the symbol registry. */
  canonical: string;
  /**
   * True when `canonical` is a different share class than `requested`, meaning
   * the caller is being shown another security's numbers.
   */
  projected: boolean;
  /** Share class of `requested`. Null unless projected. */
  requestedClass: string | null;
  /** Share class of `canonical`. Null unless projected. */
  modelledClass: string | null;
}

/** Pure resolution against a given projection table. */
function resolveAgainst(
  ticker: string,
  projections: Record<string, ClassProjection>,
): TickerResolution {
  const requested = (ticker ?? "").trim().toUpperCase();
  const normalized = NOTATION_ALIASES[requested] ?? requested;
  const projection = projections[normalized];

  if (!projection) {
    return {
      requested,
      canonical: normalized,
      projected: false,
      requestedClass: null,
      modelledClass: null,
    };
  }

  return {
    requested,
    canonical: projection.modelledTicker,
    projected: true,
    requestedClass: projection.requestedClass,
    modelledClass: projection.modelledClass,
  };
}

/**
 * Resolve a ticker to the registry ticker that answers it, reporting whether
 * the answer comes from a different share class.
 *
 * Async since H.144: the projection table is read (cached) from the
 * `security_company_map` mirror. The RESOLUTION SHAPE is unchanged — callers
 * read the same `TickerResolution` fields as before.
 */
export async function resolveTicker(ticker: string): Promise<TickerResolution> {
  return resolveAgainst(ticker, await getClassProjections());
}

/**
 * Resolve a ticker through the alias map, discarding the disclosure.
 *
 * Prefer `resolveTicker` anywhere the result is rendered or returned to a user:
 * this drops the fact that a substitution happened, which is what made the
 * collapse invisible to begin with.
 */
export async function resolveTickerAlias(ticker: string): Promise<string> {
  return (await resolveTicker(ticker)).canonical;
}

/** Array form of {@link resolveTickerAlias}. */
export async function resolveTickerAliases(
  tickers: string[],
): Promise<string[]> {
  const projections = await getClassProjections();
  return tickers.map((t) => resolveAgainst(t, projections).canonical);
}
