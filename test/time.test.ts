import { describe, it, expect } from 'vitest';
import { parseTsToEpochMs, toEpochMs, idleSeconds, humanizeAgo } from '../src/collector/time';

describe('parseTsToEpochMs', () => {
  it('parses a UTC Z timestamp to the correct absolute epoch regardless of local TZ', () => {
    // 2026-05-28T07:48:56.005Z — fixed absolute instant.
    const expected = Date.UTC(2026, 4, 28, 7, 48, 56, 5);
    expect(parseTsToEpochMs('2026-05-28T07:48:56.005Z')).toBe(expected);
  });

  it('treats a zone-less timestamp as UTC (not local) to avoid BST skew', () => {
    expect(parseTsToEpochMs('2026-05-28T07:48:56')).toBe(Date.UTC(2026, 4, 28, 7, 48, 56));
  });

  it('honours an explicit offset', () => {
    expect(parseTsToEpochMs('2026-05-28T08:48:56+01:00')).toBe(Date.UTC(2026, 4, 28, 7, 48, 56));
  });

  it('returns null for empty / bad input', () => {
    expect(parseTsToEpochMs(null)).toBeNull();
    expect(parseTsToEpochMs('')).toBeNull();
    expect(parseTsToEpochMs('not-a-date')).toBeNull();
  });
});

describe('toEpochMs', () => {
  it('passes through epoch ms', () => {
    expect(toEpochMs(1780003084027)).toBe(1780003084027);
  });
  it('scales epoch seconds to ms', () => {
    expect(toEpochMs(1780003084)).toBe(1780003084000);
  });
  it('handles null', () => {
    expect(toEpochMs(null)).toBeNull();
  });
});

describe('idleSeconds', () => {
  it('computes whole seconds since a timestamp', () => {
    const now = 1_000_000_000_000;
    expect(idleSeconds(now - 174_000, now)).toBe(174);
  });
  it('never goes negative', () => {
    const now = 1_000_000_000_000;
    expect(idleSeconds(now + 5000, now)).toBe(0);
  });
});

describe('humanizeAgo', () => {
  it('formats ranges', () => {
    expect(humanizeAgo(2)).toBe('now');
    expect(humanizeAgo(42)).toBe('42s');
    expect(humanizeAgo(150)).toBe('2m');
    expect(humanizeAgo(7200)).toBe('2h');
    expect(humanizeAgo(null)).toBe('—');
  });
});
