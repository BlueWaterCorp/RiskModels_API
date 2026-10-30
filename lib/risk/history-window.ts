export function historyStartForPredatingWindow(
  historyStart: string | undefined,
  windowEnd: string = new Date().toISOString().slice(0, 10),
): string | undefined {
  return historyStart && windowEnd < historyStart ? historyStart : undefined;
}
