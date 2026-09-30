export interface HistoryEntry { timestamp: string; path: string }

export function selectHistoryEntry(entries: HistoryEntry[], currentTimestamp: string, since: string | null): HistoryEntry | undefined {
  if (since !== null && (!/^\d{4}-\d{2}-\d{2}T/.test(since) || !Number.isFinite(Date.parse(since)))) throw new Error('Invalid since; use ISO8601');
  const history = entries.filter(e => Date.parse(e.timestamp) < Date.parse(currentTimestamp)).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  if (since === null) return history.at(-1);
  return history.filter(e => Date.parse(e.timestamp) <= Date.parse(since)).at(-1) ?? history[0];
}
