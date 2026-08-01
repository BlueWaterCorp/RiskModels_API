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
 *   CLASS_PROJECTIONS — a *different* security, answered with a sibling share
 *                       class's numbers. Only one class of a dual-class company
 *                       carries a modelled return series (ERM3 stitches the pair
 *                       in `merge_share_class_pair`), so a request for the other
 *                       class is served from its sibling. That substitutes one
 *                       security for another and MUST be reported to the caller.
 *
 * Collapsing the two is the G.35 defect: `/stocks/GOOGL` rendered GOOG's
 * decomposition to the digit with nothing marking it as Class C's, while
 * `/stocks/BRK-A` 404'd — one situation handled two different ways.
 *
 * `CLASS_PROJECTIONS` is an interim table. The authoritative point-in-time
 * source is ERM3's `security_company_map` (H.137), which carries `company_id`
 * and `is_modelled_class` per `(bw_sym_id, date)` and needs no company
 * enumerated by hand. It lives in ERM3's SQLite and is not yet mirrored into
 * Supabase; when it is, replace the constant below and leave `resolveTicker`'s
 * shape alone — callers read the resolution, never the table.
 */

/** A share class answered with a sibling class's modelled series. */
interface ClassProjection {
  /** Ticker whose modelled series actually answers the request. */
  modelledTicker: string;
  /** Share class of the requested ticker, e.g. "A". */
  requestedClass: string;
  /** Share class of the modelled ticker, e.g. "C". */
  modelledClass: string;
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
 * Different security, answered with a sibling's series. Alphabet Class A is
 * answered with Class C, Berkshire Class A with Class B — in both cases the
 * target is the class ERM3 carries a return series for.
 */
const CLASS_PROJECTIONS: Record<string, ClassProjection> = {
  GOOGL: { modelledTicker: "GOOG", requestedClass: "A", modelledClass: "C" },
  "BRK-A": { modelledTicker: "BRK-B", requestedClass: "A", modelledClass: "B" },
};

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

/**
 * Resolve a ticker to the registry ticker that answers it, reporting whether
 * the answer comes from a different share class.
 */
export function resolveTicker(ticker: string): TickerResolution {
  const requested = (ticker ?? "").trim().toUpperCase();
  const normalized = NOTATION_ALIASES[requested] ?? requested;
  const projection = CLASS_PROJECTIONS[normalized];

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
 * Resolve a ticker through the alias map, discarding the disclosure.
 *
 * Prefer `resolveTicker` anywhere the result is rendered or returned to a user:
 * this drops the fact that a substitution happened, which is what made the
 * collapse invisible to begin with.
 */
export function resolveTickerAlias(ticker: string): string {
  return resolveTicker(ticker).canonical;
}

/** Array form of {@link resolveTickerAlias}. */
export function resolveTickerAliases(tickers: string[]): string[] {
  return tickers.map(resolveTickerAlias);
}
