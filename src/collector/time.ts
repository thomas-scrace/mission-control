// All time math is in epoch-ms. The trap (validated on this machine, BST +0100):
// Codex stamps timestamps in UTC with a trailing `Z`; file mtime is OS-local epoch.
// `Date.parse` honours the `Z` / offset, so comparing its result against `Date.now()`
// (also epoch) is correct regardless of the machine timezone. A naive parse of an
// ISO string WITHOUT a zone designator is treated as LOCAL by JS — that's the bug we avoid.

/** Parse an ISO-8601 timestamp to epoch-ms. Assumes UTC if no zone is present. */
export function parseTsToEpochMs(ts: string | null | undefined): number | null {
  if (ts == null || ts === '') return null;
  // If the string carries no zone designator (no Z and no ±hh:mm), treat it as UTC.
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(ts);
  const normalized = hasZone ? ts : `${ts}Z`;
  const t = Date.parse(normalized);
  return Number.isNaN(t) ? null : t;
}

/** Codex stores some times as epoch seconds and some as epoch ms; normalize to ms. */
export function toEpochMs(value: number | null | undefined): number | null {
  if (value == null) return null;
  // Anything below ~1e12 is seconds (year ~2001 in ms); above is already ms.
  return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
}

export function idleSeconds(lastTs: number | null, now: number = Date.now()): number | null {
  if (lastTs == null) return null;
  return Math.max(0, Math.round((now - lastTs) / 1000));
}

export function humanizeAgo(sec: number | null): string {
  if (sec == null) return '—';
  if (sec < 5) return 'now';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}
