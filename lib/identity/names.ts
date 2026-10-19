/**
 * Dated security names: the name a security carried on a date (ERM3 build_security_names.py →
 * public.security_name_history). Fund names win for ETFs and funds; otherwise the issuer's legal name in force on
 * the date, with the share class appended when the security has one ("Alphabet Inc. Class A").
 */
export type NameRow = {
  bw_sym_id: string;
  kind: "issuer_legal" | "share_class" | "fund";
  name: string;
  valid_from: string | null;
  valid_to: string | null;
  source: string;
};

export type DatedName = { name: string; share_class: string | null; source: string };

function inWindow(r: NameRow, date: string): boolean {
  return (r.valid_from == null || r.valid_from <= date) && (r.valid_to == null || date < r.valid_to);
}

export function nameOn(rows: NameRow[] | undefined, date: string): DatedName | null {
  if (!rows?.length) return null;
  const cls = rows.find((r) => r.kind === "share_class")?.name ?? null;
  const fund = rows.find((r) => r.kind === "fund" && inWindow(r, date));
  if (fund) return { name: fund.name, share_class: cls, source: fund.source };
  const legal = rows.find((r) => r.kind === "issuer_legal" && inWindow(r, date));
  if (!legal) return null;
  const name = cls && !legal.name.toLowerCase().includes(cls.toLowerCase()) ? `${legal.name} ${cls}` : legal.name;
  return { name, share_class: cls, source: legal.source };
}

export function groupNames(rows: NameRow[]): Map<string, NameRow[]> {
  const out = new Map<string, NameRow[]>();
  for (const r of rows) out.set(r.bw_sym_id, [...(out.get(r.bw_sym_id) ?? []), r]);
  return out;
}

export type TickerSpan = { bw_sym_id: string; ticker: string; start: string | null; end: string | null };

/**
 * The ticker a security traded under on a date: a reviewed event window first, else a dated ticker alias
 * (undated aliases say nothing about the date). Null when neither names exactly one ticker; callers then
 * fall back to today's ticker.
 */
export function tickerOn(reviewed: TickerSpan[], aliases: TickerSpan[], id: string, date: string): string | null {
  const covers = (s: TickerSpan) => s.bw_sym_id === id && (s.start == null || s.start <= date) && (s.end == null || date < s.end);
  const one = (spans: TickerSpan[]) => {
    const t = [...new Set(spans.filter(covers).map((s) => s.ticker))];
    return t.length === 1 ? t[0] : null;
  };
  return one(reviewed) ?? one(aliases.filter((a) => a.start != null || a.end != null));
}
