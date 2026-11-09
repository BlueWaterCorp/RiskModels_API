export function summarizeHoldingValues(holdings: Array<Record<string, unknown>>): {
  total_value: number | null;
  value_coverage: number;
  data_quality_flags: string[];
} {
  const coveredValues = holdings.flatMap((holding) => {
    const raw = holding.institution_value;
    if (raw == null || raw === "") return [];
    const value = Number(raw);
    return Number.isFinite(value) ? [value] : [];
  });
  const valueCoverage = holdings.length > 0 ? coveredValues.length / holdings.length : 1;
  return {
    total_value:
      coveredValues.length > 0
        ? coveredValues.reduce((sum, value) => sum + value, 0)
        : holdings.length === 0
          ? 0
          : null,
    value_coverage: valueCoverage,
    data_quality_flags: valueCoverage < 1 ? ["holding_value_coverage_incomplete"] : [],
  };
}
