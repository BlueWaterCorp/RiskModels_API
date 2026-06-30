/**
 * Public-scope ETF factor classification — market (SPY) + 11 GICS sector SPDR
 * ETFs. This is the ONLY subset of the ERM3 ETF roster intentionally exposed
 * through the public API.
 *
 * Why this scope and no more:
 * The full ERM3 ETF roster (subsector slates, style picks, macro buckets,
 * broad-market price-coverage tier) lives in erm3/shared/etf_register.py and
 * represents proprietary curation IP. Handing that out grouped/labeled in one
 * call would hand over the BWMACRO factor playbook. The 12 ETFs below are
 * universally public — GICS sector membership is industry-standard knowledge
 * available from any prospectus — so exposing them adds no leakage on top of
 * what is already public.
 *
 * If you ever need to extend this list, that is a product-and-IP decision,
 * not a code change — ask first.
 */

export type EtfSleeve = "market" | "sector";

export interface EtfFactorEntry {
  ticker: string;
  sleeve: EtfSleeve;
  name: string;
}

export const ETF_FACTOR_REGISTRY: readonly EtfFactorEntry[] = [
  { ticker: "SPY",  sleeve: "market", name: "SPDR S&P 500 ETF Trust" },
  { ticker: "XLE",  sleeve: "sector", name: "Energy Select Sector SPDR" },
  { ticker: "XLB",  sleeve: "sector", name: "Materials Select Sector SPDR" },
  { ticker: "XLI",  sleeve: "sector", name: "Industrials Select Sector SPDR" },
  { ticker: "XLY",  sleeve: "sector", name: "Consumer Discretionary Select Sector SPDR" },
  { ticker: "XLP",  sleeve: "sector", name: "Consumer Staples Select Sector SPDR" },
  { ticker: "XLV",  sleeve: "sector", name: "Health Care Select Sector SPDR" },
  { ticker: "XLF",  sleeve: "sector", name: "Financial Select Sector SPDR" },
  { ticker: "XLK",  sleeve: "sector", name: "Technology Select Sector SPDR" },
  { ticker: "XLC",  sleeve: "sector", name: "Communication Services Select Sector SPDR" },
  { ticker: "XLU",  sleeve: "sector", name: "Utilities Select Sector SPDR" },
  { ticker: "XLRE", sleeve: "sector", name: "Real Estate Select Sector SPDR" },
];

export const ETF_SLEEVES: readonly EtfSleeve[] = ["market", "sector"];

const REGISTRY_BY_TICKER: Map<string, EtfFactorEntry> = new Map(
  ETF_FACTOR_REGISTRY.map((e) => [e.ticker, e]),
);

export function lookupEtfFactorEntry(ticker: string): EtfFactorEntry | null {
  return REGISTRY_BY_TICKER.get(ticker) ?? null;
}

export function isKnownFactorEtf(ticker: string): boolean {
  return REGISTRY_BY_TICKER.has(ticker);
}

/** Filter the registry by sleeve. Pass "all" or omit to get the full set. */
export function filterFactorRegistry(sleeve?: EtfSleeve | "all"): EtfFactorEntry[] {
  if (!sleeve || sleeve === "all") return [...ETF_FACTOR_REGISTRY];
  return ETF_FACTOR_REGISTRY.filter((e) => e.sleeve === sleeve);
}
