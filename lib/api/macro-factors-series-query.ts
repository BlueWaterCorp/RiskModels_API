/** Query parsing for GET /api/macro-factors (date range + optional factor list). */

import { DEFAULT_MACRO_FACTORS, normalizeMacroFactorKeys } from "@/lib/risk/macro-factor-keys";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 20 * 366;

export function utcTodayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addCalendarYears(ymd: string, deltaYears: number): string {
  const d = new Date(`${ymd}T12:00:00.000Z`);
  d.setUTCFullYear(d.getUTCFullYear() + deltaYears);
  return d.toISOString().slice(0, 10);
}

export function calendarDaysBetween(start: string, end: string): number {
  const a = new Date(`${start}T12:00:00.000Z`).getTime();
  const b = new Date(`${end}T12:00:00.000Z`).getTime();
  return Math.round(Math.abs(b - a) / 86_400_000);
}

export type MacroFactorsSeriesQueryOk = {
  ok: true;
  start: string;
  end: string;
  factorStrings: string[];
};

export type MacroFactorsSeriesQueryErr = { ok: false; message: string };

/**
 * Parse URLSearchParams for macro factor series GET.
 * Default range: last 5 calendar years through today (UTC). Default factors: all six canonical keys.
 */
export function parseMacroFactorsSeriesQuery(
  searchParams: URLSearchParams,
): MacroFactorsSeriesQueryOk | MacroFactorsSeriesQueryErr {
  const rawFactors = searchParams.get("factors") ?? searchParams.get("factor");
  const factorStrings = rawFactors
    ? rawFactors
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const endRaw = searchParams.get("end");
  const startRaw = searchParams.get("start");

  const end =
    endRaw && YMD.test(endRaw) ? endRaw : utcTodayYmd();
  const start =
    startRaw && YMD.test(startRaw) ? startRaw : addCalendarYears(end, -5);

  if (start > end) {
    return { ok: false, message: "start must be on or before end" };
  }

  if (calendarDaysBetween(start, end) > MAX_RANGE_DAYS) {
    return { ok: false, message: "Maximum date range is 20 years" };
  }

  const toNormalize =
    factorStrings.length > 0 ? factorStrings : [...DEFAULT_MACRO_FACTORS];
  const { keys, warnings } = normalizeMacroFactorKeys(toNormalize);
  if (keys.length === 0) {
    const hint =
      warnings[0] ??
      `No valid macro factors; use one of: ${DEFAULT_MACRO_FACTORS.join(", ")}`;
    return { ok: false, message: hint };
  }

  return { ok: true, start, end, factorStrings: keys.map(String) };
}
