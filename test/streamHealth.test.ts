import { describe, it, expect } from 'vitest';
import { isStreamStale, STREAM_STALE_MS, STREAM_HEARTBEAT_MS } from '../src/web/lib/streamHealth';

// The watchdog decides a stream is dead when no event (incl. heartbeat pings) has arrived
// for STREAM_STALE_MS — this catches half-open connections that never fire `error`.
describe('isStreamStale', () => {
  it('is fresh right after an event', () => {
    expect(isStreamStale(1_000_000, 1_000_000)).toBe(false);
  });

  it('is fresh while heartbeats are arriving (gap < threshold)', () => {
    const last = 1_000_000;
    expect(isStreamStale(last, last + STREAM_HEARTBEAT_MS + 1000)).toBe(false);
  });

  it('is stale once the silence reaches the threshold', () => {
    const last = 1_000_000;
    expect(isStreamStale(last, last + STREAM_STALE_MS)).toBe(true);
    expect(isStreamStale(last, last + STREAM_STALE_MS + 5000)).toBe(true);
  });

  it('the stale threshold is comfortably more than one heartbeat (no false positives)', () => {
    expect(STREAM_STALE_MS).toBeGreaterThan(STREAM_HEARTBEAT_MS * 2);
  });
});
